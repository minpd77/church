var ProPresenter = [];

var ConnectedMode = "Primary";

document.addEventListener('DOMContentLoaded', function(){
    // 기존 동작 유지: 페이지 로드 시 1회 연결 시도
    // 단, stagedisplay.html에서 auto-connect를 별도로 할 수 있으므로
    // 여기서도 안전하게 동작하게만 둠.
    try {
        ProPresenter[0] = new Connection();
        ProPresenter[0].connect();
    } catch(e) {
        console.error(e);
    }
});

var Connection = function() {

    this.closing = false;

    // clock locale
    var cfg = getEffectiveConfig();
    if('ClockLocale' in cfg) {
        this.clockLocale = cfg['ClockLocale'];
    } else {
        this.clockLocale = "en-AU";
    }

    return this;
};

function getEffectiveConfig() {
    // base config.js의 config를 기본으로 사용
    var cfg = (typeof config !== "undefined" && config) ? config : {};

    // stagedisplay.html에서 입력한 런타임 오버라이드
    if (typeof window !== "undefined" && window.runtimeConfigOverride) {
        var o = window.runtimeConfigOverride;

        // Proto는 base config에 없던 값이므로 별도 처리
        cfg = Object.assign({}, cfg, {
            IPAddress: (o.IPAddress !== undefined) ? o.IPAddress : cfg.IPAddress,
            IPPort: (o.IPPort !== undefined) ? o.IPPort : cfg.IPPort,
            Password: (o.Password !== undefined) ? o.Password : cfg.Password,
            Proto: (o.Proto !== undefined) ? o.Proto : (cfg.Proto || "ws")
        });
    } else {
        // Proto 기본값
        if (!('Proto' in cfg)) cfg.Proto = "ws";
    }

    return cfg;
}

function emitState(state, detail) {
    try {
        if (typeof window !== "undefined" && typeof window.onPPConnectionState === "function") {
            window.onPPConnectionState(state, detail);
        }
    } catch(e) {}
}

Connection.prototype.connect = function() {

    console.log("Trying " + ConnectedMode);

    var cfg = getEffectiveConfig();

    if(ConnectedMode == 'Primary') {
        this.ip = cfg['IPAddress'];
        this.port = cfg['IPPort'];
        this.password = cfg['Password'];
        this.proto = cfg['Proto'] || "ws";
    } else {
        this.ip = cfg['BackupIPAddress'];
        this.port = cfg['BackupIPPort'];
        this.password = cfg['BackupPassword'];
        this.proto = cfg['Proto'] || "ws";
    }

    // 방어
    if(!this.ip || !this.port) {
        emitState("error", "Missing IP/Port");
        return;
    }

    this.url = this.proto + '://' + this.ip  + ':' + this.port + '/stagedisplay';

    emitState("reconnecting", this.url);

    this.socket = new WebSocket(this.url);
    var parentThis = this;

    parentThis.socket.onopen = function() {
        emitState("connected", parentThis.url);

        // Login
        parentThis.socket.send(JSON.stringify({
            "pwd": parentThis.password,
            "ptl": 610,
            "acn": "ath"
        }));
    };

    parentThis.socket.onmessage = function(e) {
        parentThis.message(JSON.parse(e.data));
    };

    parentThis.socket.onclose = function(e) {

        if(parentThis.closing === true) {
            emitState("closed");
            return false;
        }

        emitState("reconnecting");

        setTimeout(function() {
            parentThis.connect();
        }, 1000);
    };

    parentThis.socket.onerror = function(err) {
        console.error('Socket encountered error: ', err && err.message ? err.message : err, '. Closing socket');
        emitState("error", err && err.message ? err.message : "socket error");

        try { parentThis.socket.close(); } catch(e) {}

        // failover
        if(ConnectedMode == 'Primary') {
            ConnectedMode = 'Backup';
        } else {
            ConnectedMode = 'Primary';
        }
    };
};

Connection.prototype.disconnect = function() {
    this.closing = true;
    try { this.socket.close(); } catch(e) {}

    if(ConnectedMode == 'Primary') {
        ConnectedMode = 'Backup';
    } else {
        ConnectedMode = 'Primary';
    }
};

Connection.prototype.message = function(msg) {
    // Receive messages from ProPresenter
    console.log(msg);

    var text_cs_note = "";
    var text_ns_note = "";
    var text = "";

    if (msg.acn == "ath") {
        if (msg.ath == true) {
            console.log("Authentication succeeded");
            emitState("auth_ok");
        } else {
            console.log("Authentication failed: " + msg.err);
            emitState("auth_fail", msg.err);
        }

    } else if (msg.acn == "fv") {
        // Loop first to try and find slide notes
        for(var a in msg.ary) {
            if (msg.ary[a].acn == "csn") {
                // Current slide note text:
                text_cs_note = lyric_text_cleanup(msg.ary[a].txt);
            } else if (msg.ary[a].acn == "nsn") {
                // Next slide note text:
                text_ns_note = lyric_text_cleanup(msg.ary[a].txt);
            }
        }

        // Now find the current/next text and send the callbacks
        for(var b in msg.ary) {
            if (msg.ary[b].acn == "cs") {
                // Current slide text:
                text = lyric_text_cleanup(msg.ary[b].txt);
                if(typeof callback_lyrics_current === 'function') {
                    if(callback_lyrics_current.length == 2) {
                        callback_lyrics_current(text, text_cs_note);
                    } else {
                        callback_lyrics_current(text);
                    }
                }
            } else if (msg.ary[b].acn == "ns") {
                // Next slide text:
                text = lyric_text_cleanup(msg.ary[b].txt);
                if(typeof callback_lyrics_next === 'function') {
                    if(callback_lyrics_next.length == 2) {
                        callback_lyrics_next(text, text_ns_note);
                    } else {
                        callback_lyrics_next(text);
                    }
                }
            } else if (msg.ary[b].acn == "msg") {
                // Message text:
                text = lyric_text_cleanup(msg.ary[b].txt);
                if(typeof callback_lyrics_next === 'function') {
                    if(callback_lyrics_next.length == 2) {
                        callback_lyrics_next(text, text_ns_note);
                    } else {
                        callback_lyrics_next(text);
                    }
                }
            }
        }
    } else if (msg.acn == "sys") {
        // Clock update
        if(typeof callback_clock === 'function') {
            callback_clock(msg.txt, this.clockLocale);
        }
    } else if (msg.acn == "msg") {
        // Message text:
        if(typeof callback_message === 'function') {
            callback_message(msg.txt);
        }
    }
};

String.prototype.replaceAll = function(search, replacement) {
    // From https://stackoverflow.com/a/17606289
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

function lyric_text_cleanup(text) {
    // Perform various cleanups & transformations on the text before it is sent off to be rendered

    text = text.replaceAll('\r\n', '\n');
    text = text.replaceAll('\r', '\n');
    text = text.trim();

    // Turn a bunch of special chars into HTML Entities
    text = text.replace(/[\u00A0-\u9999<>\&]/gim, function(i) {
        return '&#'+i.charCodeAt(0)+';';
    });

    // Line Separator character fix
    text = text.replaceAll('&#8232;', '\n');

    // Wrap bible verse numbers in a <span>
    text = text.replace(/([0-9]+)([A-za-z]+)/, function(all, ref, t) {
        return '<span class="verse-ref">'+ref+'</span> ' + t;
    });

    // Each line will be returned in a list
    var lines_output = [];

    if(text == '') {
        return [];
    }

    var cfg = getEffectiveConfig();

    // Allow splitting off multi-lingual versions of slides
    if(cfg['SplitLines'] !== null && cfg['SplitLines'] !== undefined) {
        var text_split = text.split(cfg['SplitLines']);
        text = text_split[cfg['SplitLinesNum']];
    }

    var lines = text.split('\n');

    for(var lineI in lines) {
        var line = lines[lineI];
        line = line.trim();
        if(line != '') {
            lines_output.push(line);
        }
    }

    return lines_output;
}

function lyrics_text_html(lines) {
    var html = '';
    for(var lineI in lines) {
        var line = lines[lineI].trim();
        if(line != "") {
            html += '<p><span>'+line+'</span></p>';
        }
    }
    return html;
}

function message_text_html(text) {

    console.log(text);
    text = text.replaceAll('\r\n', '\n');
    text = text.replaceAll('\r', '\n');
    text = text.trim();
    var lines = text.split('\n');
    console.log(lines);

    var html = '';
    if (lines[0] != "") {
        html = '<span>';

        // 메시지가 있을 때, 글자 합치기
        for(var lineI in lines) {
            var line = lines[lineI].trim();
            if(line != "") {
                html += line + ' ';
            }
        }
        html += '</span>';
    } else {
        // 메시지가 없을 때 빈값을 넘김
        html = '';
    }

    return html;
}

function clear_timeouts() {
    var id = window.setTimeout(function() {}, 0);
    while (id--) {
        window.clearTimeout(id);
    }
}
