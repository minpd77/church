var ProPresenter = [];
var ConnectedMode = "Primary";

document.addEventListener('DOMContentLoaded', function(){
  try {
    ProPresenter[0] = new Connection();
    // ✅ 자동 연결은 stagedisplay.html에서 버튼 눌러서만 하게 바꿈 (개인정보 노출 방지)
    // ProPresenter[0].connect();
  } catch(e) {
    console.error(e);
  }
});

var Connection = function() {
  this.closing = false;

  var cfg = getEffectiveConfig();
  if ('ClockLocale' in cfg && cfg['ClockLocale']) this.clockLocale = cfg['ClockLocale'];
  else this.clockLocale = "en-AU";

  return this;
};

function getEffectiveConfig() {
  var cfg = (typeof config !== "undefined" && config) ? config : {};
  if (!('Proto' in cfg)) cfg.Proto = "ws";

  // stagedisplay.html에서 입력한 런타임 오버라이드 우선
  if (typeof window !== "undefined" && window.runtimeConfigOverride) {
    var o = window.runtimeConfigOverride;
    cfg = Object.assign({}, cfg, {
      IPAddress: (o.IPAddress !== undefined) ? o.IPAddress : cfg.IPAddress,
      IPPort: (o.IPPort !== undefined) ? o.IPPort : cfg.IPPort,
      Password: (o.Password !== undefined) ? o.Password : cfg.Password,
      Proto: (o.Proto !== undefined) ? o.Proto : (cfg.Proto || "ws")
    });
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

  if (ConnectedMode == 'Primary') {
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

  if(!this.ip || !this.port) {
    emitState("error", "Missing IP/Port");
    return;
  }

  this.url = this.proto + '://' + this.ip + ':' + this.port + '/stagedisplay';

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
    if(ConnectedMode == 'Primary') ConnectedMode = 'Backup';
    else ConnectedMode = 'Primary';
  };
};

Connection.prototype.disconnect = function() {
  this.closing = true;
  try { this.socket.close(); } catch(e) {}

  if(ConnectedMode == 'Primary') ConnectedMode = 'Backup';
  else ConnectedMode = 'Primary';
};

Connection.prototype.message = function(msg) {
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

    for(var a in msg.ary) {
      if (msg.ary[a].acn == "csn") text_cs_note = lyric_text_cleanup(msg.ary[a].txt);
      else if (msg.ary[a].acn == "nsn") text_ns_note = lyric_text_cleanup(msg.ary[a].txt);
    }

    for(var b in msg.ary) {
      if (msg.ary[b].acn == "cs") {
        text = lyric_text_cleanup(msg.ary[b].txt);
        if(typeof callback_lyrics_current === 'function') {
          if(callback_lyrics_current.length == 2) callback_lyrics_current(text, text_cs_note);
          else callback_lyrics_current(text);
        }
      } else if (msg.ary[b].acn == "ns") {
        text = lyric_text_cleanup(msg.ary[b].txt);
        if(typeof callback_lyrics_next === 'function') {
          if(callback_lyrics_next.length == 2) callback_lyrics_next(text, text_ns_note);
          else callback_lyrics_next(text);
        }
      } else if (msg.ary[b].acn == "msg") {
        text = lyric_text_cleanup(msg.ary[b].txt);
        if(typeof callback_lyrics_next === 'function') {
          if(callback_lyrics_next.length == 2) callback_lyrics_next(text, text_ns_note);
          else callback_lyrics_next(text);
        }
      }
    }

  } else if (msg.acn == "sys") {
    if(typeof callback_clock === 'function') callback_clock(msg.txt, this.clockLocale);

  } else if (msg.acn == "msg") {
    if(typeof callback_message === 'function') callback_message(msg.txt);
  }
};

String.prototype.replaceAll = function(search, replacement) {
  var target = this;
  return target.replace(new RegExp(search, 'g'), replacement);
};

function lyric_text_cleanup(text) {
  text = text.replaceAll('\r\n', '\n');
  text = text.replaceAll('\r', '\n');
  text = text.trim();

  text = text.replace(/[\u00A0-\u9999<>\&]/gim, function(i) {
    return '&#'+i.charCodeAt(0)+';';
  });

  text = text.replaceAll('&#8232;', '\n');

  text = text.replace(/([0-9]+)([A-za-z]+)/, function(all, ref, t) {
    return '<span class="verse-ref">'+ref+'</span> ' + t;
  });

  var lines_output = [];
  if(text == '') return [];

  var cfg = getEffectiveConfig();

  if(cfg['SplitLines'] !== null && cfg['SplitLines'] !== undefined) {
    var text_split = text.split(cfg['SplitLines']);
    text = text_split[cfg['SplitLinesNum']];
  }

  var lines = text.split('\n');
  for(var lineI in lines) {
    var line = lines[lineI].trim();
    if(line != '') lines_output.push(line);
  }
  return lines_output;
}

function lyrics_text_html(lines) {
  var html = '';
  for(var lineI in lines) {
    var line = lines[lineI].trim();
    if(line != "") html += '<p><span>'+line+'</span></p>';
  }
  return html;
}

function message_text_html(text) {
  text = text.replaceAll('\r\n', '\n');
  text = text.replaceAll('\r', '\n');
  text = text.trim();

  var lines = text.split('\n');

  var html = '';
  if (lines[0] != "") {
    html = '<span>';
    for(var lineI in lines) {
      var line = lines[lineI].trim();
      if(line != "") html += line + ' ';
    }
    html += '</span>';
  } else {
    html = '';
  }
  return html;
}
