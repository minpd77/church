// config.js (public repo에 올릴 기본값은 비워두세요)
var config = {
  IPAddress: "",
  IPPort: 0,
  Password: "",
  Proto: "ws",
  ClockLocale: "ko-KR"
};

	// These details are optional, but will be used in the case the 1st ProPresenter connection fails
    "BackupIPAddress": "127.0.0.1",
    "BackupIPPort": 20562,
    "BackupPassword": "12345",

    "SplitLines": null, // Set this to a string to allow multi-lingual slide splitting
    "SplitLinesNum": 0, // Which version of the slide do you want to use? (hint: starts at zero)

    "ClockLocale": "en-US", // Local to use for displaying the clock

    // Un-implemented settings:

    //"MergeLines": false,
    //"MergeLinesMin": 4,
    //"MergeLinesJoinChar": ",",

    //"TimerLabels": ["Elapsed Time", "Video Countdown"]
}
