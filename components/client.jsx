import React, {Component, createRef} from 'react';
import PropTypes from 'prop-types';
import RoomsList from './rooms-list';
import TimelinePanel from './timeline-panel.jsx';
import RoomHeader from './room-header';
import MessageComposer from './message-composer';
import ThemeContext from './theme-context.jsx';
import Modal from './modal';
import SignInForm from './sign-in-form';
import ReplyPopup from './reply-popup';
import MessageHandler from '../classes/message-handler.js';
import Avatar from './avatar';

/** 
 * React component for the client 
 * 
 * @param   {string} roomId - The ID of default room
 * @param   {string} userId - The ID of default user
 * @param   {string} accessToken - Access token of default user
 * @param   {string} baseUrl - Base URL of homeserver
 * @param   {boolean} readOnly - If the client is in read-only mode
 * @param   {string} theme - Theme (dark or light)
 * @param   {string} highlight - Highlight color (green or pink)
 * @param   {boolean} roomHeader - If room header should be displayed
 * @param   {boolean} roomsList - If rooms list should be displayed
 * @param   {boolean} msgComposer - If message composer should be displayed
 * @param   {Array} whitelist - Whitelisted origins
 * @param   {string} signInPrompt - Show sign in prompt for - none, guests, all 
 */
export default class Client extends Component{
    /* static propTypes = {
        roomId: PropTypes.string.isRequired, // The ID of default room
        userId: PropTypes.string, // The ID of default user
        accessToken: PropTypes.string, // The access token of default user
        baseUrl: PropTypes.string.isRequired, // The base URL of homeserver
        readOnly: PropTypes.bool, // Enable read only mode
        theme: PropTypes.string, // Theme - default dark
        highlight: PropTypes.string, // Highlight - default pink
        roomHeader: PropTypes.bool, // Enable roomHeader? 
        roomsList: PropTypes.bool, // Enable roomsList? Overrides readOnly
        msgComposer: PropTypes.bool, // Enable msgComposer? Overrides readOnly
        whitelist: PropTypes.array, // Whitelisted origins - ignore to allow all
        signInPrompt: PropTypes.string // Show signInPrompt for - none, guests, all
    }; */

    constructor(props) {
        super(props);
        this.state = {
            room: null,
            theme: props.theme === undefined ? 'dark' : props.theme,  // Client theme (dark/light)
            highlight: props.highlight === undefined ? 'pink' : props.highlight,   // Client theme highlight (pink/green)
            roomHeader: props.roomHeader !== undefined ? props.roomHeader : true,   // If room header should be displayed
            roomsList: props.roomsList !== undefined ? props.roomsList : 
                props.readOnly !== undefined ? !props.readOnly : true,    // If rooms list should be displayed
            msgComposer: props.msgComposer !== undefined ? props.msgComposer : 
                props.readOnly !== undefined ? !props.readOnly : true,  // If message composer should be displayed
            reply: null,    // Event to reply to
            connectionError: false  // Display connection error message
        };
        this.sdk = require('matrix-js-sdk');

        // TODO: Load from whitelist from config
        this.messageHandler = new MessageHandler(this.props.whitelist);

        this.init = this.init.bind(this);
        this.onSelectRoom = this.onSelectRoom.bind(this);
        this._onRoomTimeline = this._onRoomTimeline.bind(this);
        this.setTheme = this.setTheme.bind(this);
        this.setUser = this.setUser.bind(this);
        this.toggleRoomHeader = this.toggleRoomHeader.bind(this);
        this.toggleRoomsList = this.toggleRoomsList.bind(this);
        this.toggleMsgComposer = this.toggleMsgComposer.bind(this);
        this.login = this.login.bind(this);
        this.replyTo = this.replyTo.bind(this);
        this.showReceipts = this.showReceipts.bind(this);
        this.checkConnectivity = this.checkConnectivity.bind(this);

        // Consume events from MessageHandler
        this.messageHandler.on('setTheme', this.setTheme);
        this.messageHandler.on('roomHeader', this.toggleRoomHeader);
        this.messageHandler.on('roomsList', this.toggleRoomsList);
        this.messageHandler.on('msgComposer', this.toggleMsgComposer);
        this.messageHandler.on('login', this.login);

        // Refs
        this.receiptsModal = createRef();

        // // Interval
        // setInterval(this.checkConnectivity, 5000);

        if (!props.accessToken || !props.userId) {
            // If any accessToken or userId is absent
            // Register as guest
            this.isGuest = true;

            this.client = this.sdk.createClient({
                baseUrl: props.baseUrl
            });

            this.client.registerGuest({}, (err, data) => {
                if (err) {
                    console.log('ERR: ', err);
                    return;
                }

                let userId = data.user_id;
                let accessToken = data.access_token;
                this.client = this.sdk.createClient({
                    baseUrl: props.baseUrl,
                    accessToken: accessToken,
                    userId: userId
                });
                this.client.setGuest(true);
                if (props.readOnly) {
                    this.client.peekInRoom(this.props.roomId, {syncRoom: true}).then(() => {
                        this.init();
                    });
                } else {
                    this.client.joinRoom(this.props.roomId, {syncRoom: true}).then(() => {
                        this.init();
                    });
                }
            });
        } else {
            this.isGuest = false;

            this.client = this.sdk.createClient({
                baseUrl: props.baseUrl,
                accessToken: props.accessToken,
                userId: props.userId
            });

            if (props.readOnly) {
                this.client.peekInRoom(this.props.roomId, {syncRoom: true}).then(() => {
                    this.init();
                });
            } else {
                this.client.joinRoom(this.props.roomId, {syncRoom: true}).then(() => {
                    this.init();
                });
            }
        }
    }

    /** Listener for timeline events */
    _onRoomTimeline(event, room) {
        if (room === this.state.room) {
            // If event is from current room, update
            this.setState({
                room: room
            });
        }
    }

    /** Connect client to homeserver */
    async init(callback=null) {
        this.client.startClient();
        this.client.once('sync', (state) => {
            console.log(state);
            if (state === 'PREPARED') {
                this.setState({
                    room: this.client.getRoom(this.props.roomId)
                });

                if (callback) callback();

                // Add listeners
                this.client.on('Room.timeline', this._onRoomTimeline);
                this.client.on('sync', this.checkConnectivity);
                window.addEventListener('online', () => {
                    // Force SDK to recheck
                    this.client.retryImmediately();
                });
                window.addEventListener('offline', () => {
                    // Manually show error
                    this.setState({
                        connectionError: true
                    });
                    this.client.retryImmediately();
                });
            }
        });
    }

    /** Handle clicks from room list */
    onSelectRoom(e) {
        // Unset reply
        this.replyTo();
        
        let roomId = e.currentTarget.getAttribute('id');
        this.setState({
            room: this.client.getRoom(roomId)
        });
    }

    /** Reinitialize client after login */
    setUser(userId, accessToken, callback=null) {
        this.isGuest = false;

        this.client = this.sdk.createClient({
            baseUrl: this.props.baseUrl,
            accessToken: accessToken,
            userId: userId
        });

        // Unset reply
        this.replyTo();
        
        this.init(callback);
    }

    /** Set the reply */
    replyTo(mxEvent=null) {
        this.setState({
            reply: mxEvent
        });
    }

    /** Consume setTheme event from MessageHandler */
    setTheme(args) {
        this.setState({
            theme: args.theme ? args.theme : this.state.theme,
            highlight: args.highlight ? args.highlight : this.state.highlight
        });
    }

    /** Consume roomHeader event from MessageHandler */
    toggleRoomHeader(args) {
        this.setState({
            roomHeader: args
        });
    }

    /** Consume roomsList event from MessageHandler */
    toggleRoomsList(args) {
        this.setState({
            roomsList: args
        });
    }

    /** Consume msgComposer event from MessageHandler */
    toggleMsgComposer(args) {
        this.setState({
            msgComposer: args
        });
    }

    /** Attempt login with password */
    login(args) {
        let user = args.user;
        let passwd = args.passwd;
        if (!user || !passwd) return;
        this.client.loginWithPassword(user, passwd, (err, data) => {
            if (err) {
                // Handle error
                console.log('ERROR: ', err);
            } else {
                console.log('SUCCESS: ', data);
                this.setUser(user, data.access_token);
            }
        });
    }

    /** Show read receipts for event */
    showReceipts(event) {
        // Construct read receipts for event from latest to current
        let receipts = [];
        let timeline = this.state.room.timeline;
        for (let i=timeline.length-1; i>=0; i--) {
            let evt = timeline[i];
            receipts.push(
                ...this.state.room.getReceiptsForEvent(evt)
            );
            if (event.getId() === evt.getId()) break;
        }

        // Sort in alphabetical order on userId
        // Can't sort on time as receipts are not available
        // for previous messages (hence no timestamp)
        receipts.sort((a,b) => a.userId.localeCompare(b.userId));
        
        // Generate JSX for list
        this.list = [];
        for (let receipt of receipts) {
            const userId = receipt.userId;
            let user = this.client.getUser(userId);
            let avatarUrl = user.avatarUrl;
            if (avatarUrl) {
                avatarUrl = this.client.mxcUrlToHttp(avatarUrl, 32, 32);
            }
            this.list.push(
                <li className='user-list-item'
                    key={user.userId}>
                    <Avatar imgUrl={avatarUrl} size={32} name={user.userId} />
                    <h4>{user.displayName} <i className='text-muted'>{user.userId}</i></h4>
                </li>
            );
        }

        // Show modal
        this.receiptsModal.current.open();
        this.forceUpdate();
    }

    /** Check connection and show/hide error */
    checkConnectivity() {
        // this.client.turnServer()
        //     .then(() => {
        //         this.setState({
        //             connectionError: false
        //         });
        //     })
        //     .catch(() => {
        //         this.setState({
        //             connectionError: true
        //         });
        //     });

        // Fetch state from client
        const syncState = this.client.getSyncState();
        const syncStateData = this.client.getSyncStateData();

        // Logic copied from RoomStatusBar in matrix-react-sdk
        const errorIsMauError = Boolean(
            syncStateData &&
            syncStateData.error &&
            syncStateData.error.errcode === 'M_RESOURCE_LIMIT_EXCEEDED',
        );
        const connErr = Boolean(syncState === 'ERROR' && !errorIsMauError);

        // Show or hide error
        this.setState({
            connectionError: connErr
        });
    }

    render() {
        if (!this.client) return <></>;

        // Get current room ID
        let currentRoomId = this.state.room ? this.state.room.roomId : '';
        let homeserver = this.client.getHomeserverUrl();
        
        // Sign-in prompt
        let siPrompt = false;
        if (this.props.signInPrompt === 'all') {
            // Show for everyone
            siPrompt = true;
        } else if (this.props.signInPrompt === 'guests' && this.isGuest) {
            // Show for guests and currently signed in as guest
            siPrompt = true;
        }

        return (
            <ThemeContext.Provider value={{theme: this.state.theme, highlight: this.state.highlight}}>
                <div className={`client bg-primary-${this.state.theme}`}>
                    <Modal visible={siPrompt} title='Sign in'>
                        <SignInForm client={this.client} setUser={this.setUser} />
                    </Modal>
                    
                    <Modal visible={false} title='Read by' ref={this.receiptsModal}>
                        <div className={`user-panel scrollable-${this.state.theme}`}>
                            <ul className='user-list'>
                                {this.list}
                            </ul>
                        </div>
                    </Modal>

                    {this.state.roomHeader && (<RoomHeader homeserver={homeserver}
                        room={this.state.room} />)}

                    {this.state.connectionError && <div className='room-status-bar'>
                        <b>Lost connection to the server.</b>
                    </div>}       
                    
                    <div className={`client-body bg-primary-${this.state.theme}`}>
                        {this.state.roomsList && (<RoomsList list={this.client.getRooms()} 
                            currentRoomId={currentRoomId}
                            onClick={this.onSelectRoom} />)}
                        <TimelinePanel homeserver={homeserver} room={this.state.room} 
                            client={this.client} replyTo={this.replyTo} 
                            canWrite={this.state.msgComposer} isGuest={this.isGuest}
                            showReceipts={this.showReceipts} > 
                            {this.state.reply && this.state.msgComposer ? 
                                <ReplyPopup homeserver={homeserver} 
                                    mxEvent={this.state.reply} client={this.client} 
                                    replyTo={this.replyTo} /> : 
                                <></>}
                            {this.state.msgComposer ? <MessageComposer client={this.client} 
                                roomId={currentRoomId} mxEvent={this.state.reply} 
                                unsetReply={this.replyTo} /> : <></>}
                            
                        </TimelinePanel>
                    </div>
                </div>
            </ThemeContext.Provider>
        );
    }
}
