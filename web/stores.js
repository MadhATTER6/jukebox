var _            = require('lodash'),
    Reflux       = require('reflux'),
    request      = require('superagent'),
    EventEmitter = require('eventemitter3');

var actions   = require('./actions'),
    transport = require('./transport'),
    strings   = require('./strings'),
    utils     = require('shared'),
    MODE      = utils.MODE;
var NamespacedStorage = require('./storage');

// contains the namespaced localStorage wrapper
var storage = null;
// Events:
//   storage/{key}  emitted on storage events
var emitter = new EventEmitter();

var stateMixin = {
  setState: function(newState) {
    if (!_.isPlainObject(newState)) {
      console.warn('setState takes a plain object');
      return;
    }
    Object.keys(this.state).forEach(function(key) {
      if (!_.isUndefined(newState[key])) {
        this.state[key] = newState[key];
      }
    }, this);
    this.triggerState();
  },
  triggerState: function() {
    this.trigger(this.getPublicState());
  },
  getPublicState: function() {
    return this.state;
  },
  getInitialState: function() {
    return this.getPublicState();
  },
}

var localStorageMixin = function(key) {
  return _.extend({
    init: function() {
      if (storage) {
        this.load();
      } else {
        emitter.on('room-established', function() {
          this.load();
        }, this);
      }
      emitter.on('storage/'+key, function(e) {
        this.setState(JSON.parse(e.newValue));
      }, this);
    },
    load: function() {
      var value = storage.getItem(key); // will be a string or null
      // but if 'undefined' or 'null' is stored, there's probably a bug on
      // the write side
      if (value === null) {
        // nothing to load
        return;
      } else if (value === 'undefined' || value === 'null') {
        throw new Error('invalid representation found in localStorage: ' +
                        value);
      } else {
        this.setState(JSON.parse(value));
      }
    },
    dump: function() {
      storage.setItem(key, JSON.stringify(this.state));
    },
  }, stateMixin);
};

// The stores.
// Everything depends on room, so that loads first.
var room = exports.room = Reflux.createStore({
  mixins: [stateMixin],
  listenables: [actions.general, actions.room],
  state: {
    id: null,
    pathtoken: null,
    name: null,
    peer: null,
    password: null,
  },

  init: function() {
    if (window.vars && window.vars.room) {
      this.setState(window.vars.room);
    }
    if (this.state.id) {
      console.log('loaded room.id:', this.state.id);
      // load the Storage device for the room once id is set
      storage = new NamespacedStorage(this.state.id);
      emitter.emit('room-established');
    }
  },

  onCreateRoom: function(roomState) {
    this.setState({ password: roomState.password });
  },

  // from http api call
  onCreateRoomCompleted: function(status, body) {
    this.setState(body);
    // load the Storage device for the room once id is set
    storage = new NamespacedStorage(body.id);
    emitter.emit('room-established');
  },

  onJoinRoomAsHostCompleted: function() {
  },

  onJoinRoomAsClientCompleted: function() {
  },

  onUpdateCompleted: function(status, body) {
    // http api call
    this.setState(body);
  },
});


var general = exports.general = Reflux.createStore({
  mixins: [stateMixin],
  listenables: [actions.general],
  state: {
    mode: null,
    peerId: null,
    pathtoken: null,
    error: null,
  },

  init: function() {
    if (!window.vars) {
      console.error('no global vars set');
      return;
    }
    if (window.vars.mode === MODE.CREATE) {
      console.log('setting mode from window.vars: CREATE');
      this.setState({mode: MODE.CREATE});
    } else if (window.vars.mode === MODE.JOIN) {
      console.log('setting mode from window.vars: JOIN');
      this.setState({mode: MODE.JOIN});
    } else {
      console.log('invalid mode in window.vars');
      this.setState({mode: MODE.ERROR});
    }
    this.setState({pathtoken: window.location.pathname.slice(1)});
    window.onpopstate = function(evt) {
      this.setState(evt.state);
    };
  },

  updateHistory: function() {
    history.pushState(
      this.state,
      "Peertable: "+this.state.name, // title
      '/'+this.state.pathtoken // pathname
    );
    console.log('pushed state for', this.state.pathtoken);
  },

  onCreateRoomFailed: function(err, res) {
    console.log('pretend tooltip');
    actions.general.handleError('createRoom', res);
  },

  onCreateRoomCompleted: function(status, body) {
    this.setState({
      mode: MODE.HOST,
      pathtoken: body.pathtoken,
      error: null,
    });
    this.updateHistory();
  },

  onJoinRoomAsHostCompleted: function() {
    this.setState({
      mode: MODE.HOST,
      error: null,
    });
    console.log('set mode to HOST');
  },
  
  onJoinRoomAsClientFailed: function(err) {
    console.log('pretend tooltip');
    actions.general.handleError('joinRoomAsClient', err);
  },

  onJoinRoomAsClientCompleted: function() {
    this.setState({
      mode: MODE.CLIENT,
      error: null,
    });
  },

  // this error handling is terrible
  onHandleError: function(context, res) {
    if (res.status >= 500) {
      this.setState({error: strings.ERROR_SERVER_FAILURE});
      return;
    }
    switch (context) {
      case 'createRoom':
        if (res.status == 400 && res.body.attribute == 'pathtoken') {
          switch (res.body.reason) {
            case 'duplicate':
              this.setState({error: strings.TOOLTIP_PATHTOKEN_DUPLICATE});
            case 'invalid':
              this.setState({error: strings.TOOLTIP_PATHTOKEN_INVALID});
          }
        }
    }
    this.setState({error: strings.ERROR_UNKNOWN});
  },

  onClearError: function() {
    this.setState({error: null});
  },
});


// authorizations are persisted differently than other data.
// One host auth object lives in the global namespace at 'hostAuth',
// Client auth objects live at 'ns/{id}/auth'.
var auth = exports.auth = Reflux.createStore({
  listenables: [actions.general],

  mode: null,
  credentials: null,

  init: function() {
    // If a room id was set then try to load authorization credentials.
    if (room.state.id) {
      var hostAuth = JSON.parse(localStorage.getItem('hostAuth'));
      var clientAuth = JSON.parse(storage.getItem('auth'));
      // check host auth first then client auth
      if (_.isPlainObject(hostAuth) && hostAuth.id == room.state.id) {
        console.log('found matching host auth');
        this.mode = MODE.HOST;
        room.setState(_.pick(hostAuth, 'password'));
        this.credentials = _.pick(hostAuth, 'key');
        actions.general.joinRoomAsHost();
      } else if (_.isPlainObject(clientAuth)) {
        console.log('found client auth');
        this.mode = MODE.CLIENT;
        this.credentials = _.pick(clientAuth, 'clientId', 'clientSecret');
        actions.general.joinRoomAsClient(this.credentials);
      } else {
        console.log('no auth found');
      }
    }
  },

  dump: function() {
    if (this.mode == MODE.HOST) {
      // use global-namespace storage device
      localStorage.setItem('hostAuth', JSON.stringify({
        id: room.state.id,
        password: room.state.password,
        key: this.credentials.key,
      }));
    } else if (this.mode == MODE.CLIENT) {
      // use namespaced storage device
      if (_.isObject(this.credentials)) {
        var clientAuth = _.pick(this.credentials, 'clientId', 'clientSecret');
        storage.setItem('auth', JSON.stringify(clientAuth));
      } else {
        storage.removeItem('auth');
      }
    } else {
      console.log('can\'t dump empty auth');
    }
  },

  onCreateRoomCompleted: function(status, body) {
    this.mode = MODE.HOST;
    this.credentials = _.pick(body, 'key');
    this.dump();
  },

  onJoinRoomAsClientCompleted: function(response) {
    // if the auth mode is unset, a password-auth has occurred.
    if (this.mode == null) {
      console.log('recording new credentials');
      this.mode = MODE.CLIENT;
      this.credentials = _.pick(response, 'clientId', 'clientSecret');
      this.dump();
    }
  },

  onJoinRoomAsHostFailed: function() {
    // host auth failed, clear it?
    console.log('failed to join room with host auth');
  },

  onJoinRoomAsClientFailed: function() {
    // client auth failed, clear it?
    console.log('failed to join room with client auth');
    this.credentials = null;
  },
});

var player = exports.player = Reflux.createStore({
  //mixins: [localStorageMixin('player')],
  state: {
    playing: false,
    isSpotify: null,
    pointer: null,
  },

  init: function() {
  },
});

var a = localStorageMixin('asdf');
for (p in a) {
  console.log(p, a[p]);
}

var playlist = exports.playlist = Reflux.createStore({
  mixins: [localStorageMixin('playlist')],
  listenables: [actions.clients, actions.player],

  state: {
    clients: [],
    current: null,
    next: null,
  },

  getPublicState: function() {
    return [this.state.current, this.state.next];
  },

  init: function() {
  },

  onNewClient: function(clientId) {
    this.state.clients.push(clientId);
    this.dump();
    // no need to trigger
  },

  onNext: function() {
    if (this.state.next) {
      this.setState({
        current: this.state.next,
        next: null,
      });
    } else if (this.state.current) {
      this.setState({
        current: null,
      });
    }
    actions.playlist.update();
  },

});

var queue = exports.queue = Reflux.createStore({
  mixins: [localStorageMixin('queue')],
  listenables: [actions.queue],

  state: {
    nextId: 0,
    tracks: [],
  },

  getPublicState: function() {
    return this.state.tracks;
  },

  init: function() {
  },

  onAddTrack: function(track) {
    track.id = this.state.nextId++;
    this.state.tracks.push(track);
    this.dump();
    console.log('triggering queue update');
    this.triggerState();
  },

  onRemoveTrack: function(track) {
    _.remove(this.tracks, 'id', track.id);
  },

});
