const CONFIG = {
    api: {
        baseUrl: '/api'
    },
    mqtt: {
        url: 'wss://hackerlo.online/mqtt',
        username: 'iot',
        password: 'iot',
        deviceId: 'iot_01'
    },
    storage: {
        tokenKey: 'iot_token',
        sessionKey: 'iot_session'
    }
};
/* đã đổi */
const API = {
    async request(endpoint, options = {}) {
        const token = localStorage.getItem(CONFIG.storage.tokenKey);

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(token && { 'Authorization': `Bearer ${token}` })
            },
            ...options
        };

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', body });
    },

    put(endpoint, body) {
        return this.request(endpoint, { method: 'PUT', body });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
};

const TOPICS = {
    log: `iot/rfid/${CONFIG.mqtt.deviceId}/log`,
    ack: `iot/rfid/${CONFIG.mqtt.deviceId}/ack`,
    status: `iot/rfid/${CONFIG.mqtt.deviceId}/status`,
    cmd: `iot/rfid/${CONFIG.mqtt.deviceId}/cmd`
};

let mqttClient = null;
let currentUser = null;
let doorStatus = 'LOCKED';
let deviceOnlineStatus = false;
let isAuthenticated = false;
let sessionMonitorInterval = null;

const DOM = {
    loginPage: document.getElementById('loginPage'),
    loginForm: document.getElementById('loginForm'),
    loginError: document.getElementById('loginError'),
    usernameInput: document.getElementById('username'),
    passwordInput: document.getElementById('password'),

    dashboard: document.getElementById('dashboard'),
    clockTime: document.getElementById('clockTime'),
    clockDate: document.getElementById('clockDate'),
    userAvatar: document.getElementById('userAvatar'),
    userName: document.getElementById('userName'),
    btnLogout: document.getElementById('btnLogout'),

    mqttStatus: document.getElementById('mqttStatus'),
    mqttStatusText: document.getElementById('mqttStatusText'),
    deviceStatus: document.getElementById('deviceStatus'),
    doorStatus: document.getElementById('doorStatus'),
    doorStatusText: document.getElementById('doorStatusText'),

    btnConnect: document.getElementById('btnConnect'),
    btnUnlock: document.getElementById('btnUnlock'),
    btnLock: document.getElementById('btnLock'),
    btnPing: document.getElementById('btnPing'),
    btnBuzz: document.getElementById('btnBuzz'),
    btnStats: document.getElementById('btnStats'),

    logStream: document.getElementById('logStream'),
    historyList: document.getElementById('historyList'),
    historyTabs: document.querySelectorAll('.history-tab'),
    btnClearHistory: document.getElementById('btnClearHistory'),

    statsModal: document.getElementById('statsModal'),
    statsModalClose: document.getElementById('statsModalClose'),
    statsModalOverlay: null,
    timeRangeSelector: document.getElementById('timeRangeSelector'),
    customDateRange: document.getElementById('customDateRange'),
    customStartDate: document.getElementById('customStartDate'),
    customEndDate: document.getElementById('customEndDate'),

    toastContainer: document.getElementById('toastContainer')
};

const AuthGuard = {
    isAuthenticated() {
        return isAuthenticated && currentUser !== null && localStorage.getItem(CONFIG.storage.tokenKey) !== null;
    },

    async validateSession() {
        const token = localStorage.getItem(CONFIG.storage.tokenKey);
        if (!token) {
            this.forceLogout('No token found');
            return false;
        }

        try {
            const response = await API.get('/auth/verify');
            if (response.success) {
                return true;
            } else {
                this.forceLogout('Token validation failed');
                return false;
            }
        } catch (error) {
            console.error('Session validation error:', error);
            this.forceLogout('Session expired');
            return false;
        }
    },

    forceLogout(reason) {
        console.warn('Force logout:', reason);
        isAuthenticated = false;
        currentUser = null;
        localStorage.removeItem(CONFIG.storage.tokenKey);
        localStorage.removeItem(CONFIG.storage.sessionKey);

        if (mqttClient && mqttClient.connected) {
            mqttClient.end();
        }

        Auth.showLogin();
        Toast.show('warning', 'Phiên đã hết hạn', 'Vui lòng đăng nhập lại');
    },

    requireAuth(action, actionName = 'this action') {
        if (!this.isAuthenticated()) {
            Toast.show('error', 'Chưa xác thực', `Bạn cần đăng nhập để ${actionName}`);
            this.forceLogout('Unauthorized action attempt');
            return false;
        }
        return true;
    },

    startSessionMonitoring() {
        if (sessionMonitorInterval) {
            clearInterval(sessionMonitorInterval);
        }

        sessionMonitorInterval = setInterval(async () => {
            if (isAuthenticated) {
                const valid = await this.validateSession();
                if (!valid) {
                    clearInterval(sessionMonitorInterval);
                }
            }
        }, 5 * 60 * 1000);
    },

    stopSessionMonitoring() {
        if (sessionMonitorInterval) {
            clearInterval(sessionMonitorInterval);
            sessionMonitorInterval = null;
        }
    }
};

const Auth = {
    async init() {
        const token = localStorage.getItem(CONFIG.storage.tokenKey);
        if (token) {
            try {
                const response = await API.get('/auth/verify');
                if (response.success) {
                    currentUser = response.data.user;
                    isAuthenticated = true;
                    this.showDashboard();
                    AuthGuard.startSessionMonitoring();
                    return;
                }
            } catch (error) {
                console.error('Token verification failed:', error);
                localStorage.removeItem(CONFIG.storage.tokenKey);
            }
        }
        isAuthenticated = false;
        this.showLogin();
    },

    async login(username, password) {
        try {
            const response = await API.post('/auth/login', { username, password });

            if (response.success) {
                localStorage.setItem(CONFIG.storage.tokenKey, response.data.token);
                currentUser = response.data.user;
                isAuthenticated = true;
                this.showDashboard();
                AuthGuard.startSessionMonitoring();
                Toast.show('success', 'Đăng nhập thành công', `Chào mừng ${username}!`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Login error:', error);
            Toast.show('error', 'Lỗi đăng nhập', error.message);
            return false;
        }
    },

    async logout() {
        try {
            await API.post('/auth/logout');
        } catch (error) {
            console.error('Logout error:', error);
        }

        isAuthenticated = false;
        currentUser = null;
        localStorage.removeItem(CONFIG.storage.tokenKey);
        localStorage.removeItem(CONFIG.storage.sessionKey);

        AuthGuard.stopSessionMonitoring();

        if (mqttClient && mqttClient.connected) {
            mqttClient.end();
        }

        this.showLogin();
        Toast.show('info', 'Đã đăng xuất', 'Bạn đã đăng xuất khỏi hệ thống');
    },

    showLogin() {
        DOM.loginPage.style.display = 'flex';
        DOM.dashboard.classList.remove('active');
        DOM.dashboard.style.display = 'none';
        DOM.usernameInput.focus();
    },

    showDashboard() {
        if (!AuthGuard.isAuthenticated()) {
            console.warn('Attempted to show dashboard without authentication');
            this.showLogin();
            return;
        }

        DOM.loginPage.style.display = 'none';
        DOM.dashboard.style.display = 'block';
        DOM.dashboard.classList.add('active');
        DOM.userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
        DOM.userName.textContent = currentUser.username;
        Clock.start();
        History.load();
    }
};

const Clock = {
    intervalId: null,

    start() {
        this.update();
        this.intervalId = setInterval(() => this.update(), 1000);
    },

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    },

    update() {
        const now = new Date();

        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        DOM.clockTime.textContent = `${hours}:${minutes}:${seconds}`;

        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        DOM.clockDate.textContent = now.toLocaleDateString('vi-VN', options);
    }
};

const MQTT = {
    connect() {
        if (!AuthGuard.requireAuth(null, 'kết nối MQTT')) {
            return;
        }

        if (mqttClient && mqttClient.connected) {
            Toast.show('info', 'Đã kết nối', 'Bạn đã kết nối đến MQTT broker');
            return;
        }

        const url = CONFIG.mqtt.url;

        DOM.btnConnect.classList.add('sending');
        DOM.btnConnect.querySelector('h3').textContent = 'Đang kết nối...';

        mqttClient = mqtt.connect(url, {
            username: CONFIG.mqtt.username,
            password: CONFIG.mqtt.password,
            reconnectPeriod: 3000
        });

        mqttClient.on('connect', () => {
            this.updateStatus(true);
            DOM.btnConnect.classList.remove('sending');
            DOM.btnConnect.querySelector('h3').textContent = 'Kết nối MQTT';

            mqttClient.subscribe([TOPICS.log, TOPICS.ack, TOPICS.status], { qos: 1 });

            Log.add('system', 'SYS', 'Đã kết nối thành công đến MQTT Broker');
            Toast.show('success', 'Kết nối thành công', 'Đã kết nối đến MQTT Broker');

            History.add({
                type: 'system',
                title: 'Kết nối MQTT',
                desc: 'Đã kết nối thành công đến broker',
                icon: '<i class="fas fa-satellite-dish"></i>'
            });
        });

        mqttClient.on('message', (topic, payload) => {
            const message = payload.toString();
            const topicName = topic.split('/').pop();
            Log.add('receive', topicName.toUpperCase(), message);

            try {
                const data = JSON.parse(message);
                if (data.doorStatus) {
                    this.updateDoorStatus(data.doorStatus);
                }

                if (data.status) {
                    this.updateDeviceStatus(data.status);
                }

                if (data.type === 'RFID_SCAN' || data.uid) {
                    if (data.uid && data.status) {
                        const isValid = data.status === 'VALID';
                        History.add({
                            type: 'rfid',
                            title: isValid ? 'Thẻ hợp lệ' : 'Thẻ không hợp lệ',
                            desc: `UID: ${data.uid}`,
                            icon: isValid ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>' : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>'
                        });
                    }
                    else if (data.uid) {
                        History.add({
                            type: 'rfid',
                            title: 'Quét thẻ RFID',
                            desc: `UID: ${data.uid}`,
                            icon: '<i class="fas fa-id-card"></i>'
                        });
                    }
                }
            } catch (e) {
            }
        });

        mqttClient.on('close', () => {
            this.updateStatus(false);
            Log.add('system', 'SYS', 'Ngắt kết nối');
        });

        mqttClient.on('error', (err) => {
            Log.add('error', 'ERR', err.message);
            Toast.show('error', 'Lỗi kết nối', err.message);
        });
    },

    updateStatus(connected) {
        if (connected) {
            DOM.mqttStatus.className = 'status-badge connected';
            DOM.mqttStatus.textContent = 'CONNECTED';
            DOM.mqttStatusText.textContent = 'Đã kết nối';
        } else {
            DOM.mqttStatus.className = 'status-badge disconnected';
            DOM.mqttStatus.textContent = 'DISCONNECTED';
            DOM.mqttStatusText.textContent = 'Chưa kết nối';
            deviceOnlineStatus = false;
            DOM.deviceStatus.textContent = 'Offline';
        }
    },

    updateDoorStatus(status) {
        doorStatus = status;
        if (status === 'UNLOCKED') {
            DOM.doorStatus.className = 'status-badge unlocked';
            DOM.doorStatus.textContent = 'UNLOCKED';
            DOM.doorStatusText.textContent = 'Đang mở khóa';
        } else {
            DOM.doorStatus.className = 'status-badge locked';
            DOM.doorStatus.textContent = 'LOCKED';
            DOM.doorStatusText.textContent = 'Đã khóa';
        }
    },

    updateDeviceStatus(status) {
        const isOnline = status !== 'OFFLINE';
        deviceOnlineStatus = isOnline;
        DOM.deviceStatus.textContent = isOnline ? 'Online' : 'Offline';
        if (status === 'DOOR_OPEN') {
            this.updateDoorStatus('UNLOCKED');
        } else if (status === 'DOOR_CLOSED') {
            this.updateDoorStatus('LOCKED');
        }
    },

    sendCommand(cmd, extra = {}) {
        if (!mqttClient || !mqttClient.connected) {
            Toast.show('error', 'Lỗi', 'Chưa kết nối đến MQTT Broker');
            Log.add('error', 'ERR', 'Chưa kết nối đến MQTT Broker');
            return;
        }

        const message = {
            id: `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            cmd,
            ...extra
        };

        mqttClient.publish(TOPICS.cmd, JSON.stringify(message), { qos: 1 });
        Log.add('send', 'CMD', JSON.stringify(message));

        return message.id;
    }
};

const Control = {
    unlock(durationMs = 2000) {
        if (!AuthGuard.requireAuth(null, 'mở khóa cửa')) {
            return;
        }

        if (!deviceOnlineStatus) {
            Toast.show('warning', 'Thiết bị offline', 'Không thể gửi lệnh khi thiết bị ngoại tuyến');
            return;
        }

        const btn = DOM.btnUnlock;
        btn.classList.add('sending');

        MQTT.sendCommand('UNLOCK', { durationMs });

        History.add({
            type: 'unlock',
            title: 'Mở khóa cửa',
            desc: `Thời gian: ${durationMs}ms`,
            icon: '<i class="fas fa-lock-open"></i>'
        });

        Toast.show('success', 'Đã gửi lệnh', `Mở khóa cửa trong ${durationMs}ms`);

        setTimeout(() => btn.classList.remove('sending'), 500);
    },

    lock() {
        if (!AuthGuard.requireAuth(null, 'khóa cửa')) {
            return;
        }

        if (!deviceOnlineStatus) {
            Toast.show('warning', 'Thiết bị offline', 'Không thể gửi lệnh khi thiết bị ngoại tuyến');
            return;
        }

        const btn = DOM.btnLock;
        btn.classList.add('sending');

        MQTT.sendCommand('LOCK');

        History.add({
            type: 'lock',
            title: 'Khóa cửa',
            desc: 'Đã gửi lệnh khóa cửa',
            icon: '<i class="fas fa-lock"></i>'
        });

        Toast.show('success', 'Đã gửi lệnh', 'Khóa cửa');

        setTimeout(() => btn.classList.remove('sending'), 500);
    },

    ping() {
        if (!AuthGuard.requireAuth(null, 'ping thiết bị')) {
            return;
        }

        if (!deviceOnlineStatus) {
            Toast.show('warning', 'Thiết bị offline', 'Không thể ping khi thiết bị ngoại tuyến');
            return;
        }

        const btn = DOM.btnPing;
        btn.classList.add('sending');

        MQTT.sendCommand('PING');

        Toast.show('info', 'PING', 'Đã gửi yêu cầu ping đến thiết bị');

        setTimeout(() => btn.classList.remove('sending'), 500);
    },

    buzz(durationMs = 300) {
        if (!AuthGuard.requireAuth(null, 'kích hoạt còi')) {
            return;
        }

        if (!deviceOnlineStatus) {
            Toast.show('warning', 'Thiết bị offline', 'Không thể kích hoạt còi khi thiết bị ngoại tuyến');
            return;
        }

        const btn = DOM.btnBuzz;
        btn.classList.add('sending');

        MQTT.sendCommand('BUZZ', { durationMs });

        Toast.show('info', 'BUZZ', `Kích hoạt còi trong ${durationMs}ms`);

        setTimeout(() => btn.classList.remove('sending'), 500);
    }
};

const Log = {
    add(type, topic, message) {
        const now = new Date();
        const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const emptyState = DOM.logStream.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        const logInfo = this.parseMessage(topic, message);

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
      <div class="log-icon">${logInfo.icon}</div>
      <div class="log-content">
        <div class="log-header">
          <span class="log-title">${logInfo.title}</span>
          <span class="log-time">${time}</span>
        </div>
        <div class="log-desc">${logInfo.desc}</div>
      </div>
    `;

        DOM.logStream.appendChild(entry);
        DOM.logStream.scrollTop = DOM.logStream.scrollHeight;

        while (DOM.logStream.children.length > 100) {
            DOM.logStream.removeChild(DOM.logStream.firstChild);
        }
    },

    parseMessage(topic, message) {
        const topicLower = topic.toLowerCase();
        let parsed = null;

        try {
            parsed = JSON.parse(message);
        } catch (e) {
        }

        if (topicLower === 'sys') {
            return {
                icon: '<i class="fas fa-bolt"></i>',
                title: 'Hệ thống',
                desc: message
            };
        }

        if (topicLower === 'err') {
            return {
                icon: '<i class="fas fa-times-circle" style="color: #ef4444;"></i>',
                title: 'Lỗi',
                desc: message
            };
        }

        if (topicLower === 'cmd' && parsed) {
            const cmdName = parsed.cmd || 'COMMAND';
            const icons = {
                'UNLOCK': '<i class="fas fa-lock-open"></i>',
                'LOCK': '<i class="fas fa-lock"></i>',
                'PING': '<i class="fas fa-signal"></i>',
                'BUZZ': '<i class="fas fa-bell"></i>'
            };
            const titles = {
                'UNLOCK': 'Gửi lệnh mở khóa',
                'LOCK': 'Gửi lệnh khóa cửa',
                'PING': 'Kiểm tra kết nối',
                'BUZZ': 'Kích hoạt còi'
            };
            let desc = `ID: ${parsed.id?.split('_').pop() || 'N/A'}`;
            if (parsed.durationMs) {
                desc += ` • Thời gian: ${parsed.durationMs}ms`;
            }
            return {
                icon: icons[cmdName] || '<i class="fas fa-paper-plane"></i>',
                title: titles[cmdName] || `Lệnh ${cmdName}`,
                desc: desc
            };
        }

        if (topicLower === 'ack' && parsed) {
            const success = parsed.ok === true;
            return {
                icon: success ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-exclamation-triangle"></i>',
                title: success ? 'Phản hồi thành công' : 'Phản hồi lỗi',
                desc: parsed.message || 'Thiết bị đã xử lý yêu cầu'
            };
        }

        if (topicLower === 'status' && parsed) {
            const status = parsed.status || 'UNKNOWN';
            const isOnline = status === 'ONLINE';
            return {
                icon: isOnline ? '<i class="fas fa-circle" style="color: #10b981;"></i>' : '<i class="fas fa-circle" style="color: #ef4444;"></i>',
                title: 'Trạng thái thiết bị',
                desc: isOnline ? 'Thiết bị đang hoạt động' : 'Thiết bị ngoại tuyến'
            };
        }

        if (topicLower === 'log') {
            if (parsed) {
                if (parsed.uid && parsed.status) {
                    const isValid = parsed.status === 'VALID';
                    return {
                        icon: isValid ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>' : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>',
                        title: isValid ? 'Thẻ hợp lệ' : 'Thẻ không hợp lệ',
                        desc: `UID: ${parsed.uid}`
                    };
                }
                if (parsed.type === 'RFID_SCAN' || parsed.uid) {
                    return {
                        icon: '<i class="fas fa-id-card"></i>',
                        title: 'Quét thẻ RFID',
                        desc: `UID: ${parsed.uid || 'Không xác định'}`
                    };
                }
                if (parsed.event === 'DOOR_OPENED') {
                    return {
                        icon: '<i class="fas fa-door-open"></i>',
                        title: 'Cửa đã mở',
                        desc: parsed.method ? `Phương thức: ${parsed.method}` : 'Cửa được mở'
                    };
                }
                if (parsed.event === 'DOOR_CLOSED') {
                    return {
                        icon: '<i class="fas fa-door-closed"></i>',
                        title: 'Cửa đã đóng',
                        desc: 'Cửa đã được đóng lại'
                    };
                }
                if (parsed.event === 'MOTION' || parsed.motion) {
                    return {
                        icon: '<i class="fas fa-walking"></i>',
                        title: 'Phát hiện chuyển động',
                        desc: 'Có người đang tiếp cận'
                    };
                }
                if (parsed.event === 'BELL' || parsed.bell) {
                    return {
                        icon: '<i class="fas fa-bell"></i>',
                        title: 'Chuông cửa',
                        desc: 'Có người bấm chuông'
                    };
                }

                if (parsed.message || parsed.msg) {
                    return {
                        icon: '<i class="fas fa-file-alt"></i>',
                        title: 'Log thiết bị',
                        desc: parsed.message || parsed.msg
                    };
                }
                return {
                    icon: '<i class="fas fa-clipboard"></i>',
                    title: 'Log thiết bị',
                    desc: this.formatParsedData(parsed)
                };
            }
            return {
                icon: '<i class="fas fa-file-alt"></i>',
                title: 'Log thiết bị',
                desc: message
            };
        }
        if (parsed) {
            return {
                icon: '<i class="fas fa-envelope"></i>',
                title: topic,
                desc: this.formatParsedData(parsed)
            };
        }

        return {
            icon: '<i class="fas fa-envelope"></i>',
            title: topic,
            desc: typeof message === 'string' && message.length > 100
                ? message.substring(0, 100) + '...'
                : message
        };
    },

    formatParsedData(obj) {
        const parts = [];
        for (const [key, value] of Object.entries(obj)) {
            if (key === 'ts' || key === 'timestamp') continue;

            let displayValue = value;
            if (typeof value === 'boolean') {
                displayValue = value ? 'Có' : 'Không';
            }
            const keyMap = {
                'uid': 'UID',
                'status': 'Trạng thái',
                'cmd': 'Lệnh',
                'ok': 'Thành công',
                'message': 'Thông báo',
                'msg': 'Thông báo',
                'event': 'Sự kiện',
                'type': 'Loại',
                'id': 'ID',
                'durationMs': 'Thời gian'
            };

            const displayKey = keyMap[key] || key;
            parts.push(`${displayKey}: ${displayValue}`);
        }
        return parts.join(' • ') || 'Không có dữ liệu';
    },

    clear() {
        DOM.logStream.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-satellite-dish"></i></div>
        <h3>Chưa có dữ liệu</h3>
        <p>Kết nối MQTT để xem log realtime</p>
      </div>
    `;
    }
};

const History = {
    items: [],
    currentFilter: 'all',

    async load() {
        if (!AuthGuard.isAuthenticated()) {
            return;
        }

        try {
            const response = await API.get('/history?limit=100');
            if (response.success) {
                this.items = response.data;
                this.render();
            }
        } catch (error) {
            console.error('Load history error:', error);
            this.items = [];
            this.render();
        }
    },

    async add(item) {
        try {
            const response = await API.post('/history', item);
            if (response.success) {
                // Add to local items for immediate UI update
                this.items.unshift(response.data);

                if (this.items.length > 100) {
                    this.items = this.items.slice(0, 100);
                }

                this.render();
            }
        } catch (error) {
            console.error('Add history error:', error);
            Toast.show('error', 'Lỗi', 'Không thể lưu lịch sử');
        }
    },

    async clear() {
        if (!AuthGuard.requireAuth(null, 'xóa lịch sử')) {
            return;
        }

        try {
            const response = await API.delete('/history');
            if (response.success) {
                this.items = [];
                this.render();
                Toast.show('info', 'Đã xóa', 'Lịch sử đã được xóa');
            }
        } catch (error) {
            console.error('Clear history error:', error);
            Toast.show('error', 'Lỗi', 'Không thể xóa lịch sử');
        }
    },

    filter(type) {
        this.currentFilter = type;
        DOM.historyTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.filter === type);
        });
        this.render();
    },

    render() {
        const filtered = this.currentFilter === 'all'
            ? this.items
            : this.items.filter(item => item.type === this.currentFilter);

        if (filtered.length === 0) {
            DOM.historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fas fa-clipboard"></i></div>
          <h3>Chưa có lịch sử</h3>
          <p>Các hoạt động sẽ được hiển thị ở đây</p>
        </div>
      `;
            return;
        }

        DOM.historyList.innerHTML = filtered.map(item => {
            const date = new Date(item.timestamp);
            const timeStr = date.toLocaleTimeString('vi-VN');
            const dateStr = date.toLocaleDateString('vi-VN');

            return `
        <div class="history-item">
          <div class="history-icon ${item.type}">${item.icon}</div>
          <div class="history-content">
            <div class="history-title">${item.title}</div>
            <div class="history-desc">${item.desc}</div>
          </div>
          <div class="history-time">
            <div>${timeStr}</div>
            <div>${dateStr}</div>
          </div>
        </div>
      `;
        }).join('');
    }
};

const Toast = {
    show(type, title, message) {
        const icons = {
            success: '<i class="fas fa-check-circle" style="color: #10b981;"></i>',
            error: '<i class="fas fa-times-circle" style="color: #ef4444;"></i>',
            info: '<i class="fas fa-info-circle" style="color: #3b82f6;"></i>',
            warning: '<i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
      <span class="toast-icon">${icons[type]}</span>
      <div class="toast-content">
        <h4>${title}</h4>
        <p>${message}</p>
      </div>
    `;

        DOM.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
};

const Statistics = {
    charts: {
        activity: null,
        distribution: null,
        hourly: null
    },
    data: [],
    currentTimeRange: 'week',
    customStartDate: null,
    customEndDate: null,

    async open() {
        if (!AuthGuard.requireAuth(null, 'xem thống kê')) {
            return;
        }

        const modal = document.getElementById('statsModal');
        modal.classList.add('active');

        await this.loadData();

        if (!this.charts.activity) {
            this.init();
        } else {
            this.updateCharts();
        }
    },

    close() {
        const modal = document.getElementById('statsModal');
        modal.classList.remove('active');
    },

    async loadData() {
        try {
            const response = await API.get('/history?limit=10000&include_deleted=true');
            if (response.success) {
                this.data = response.data;
            } else {
                this.data = [];
            }
        } catch (error) {
            console.error('Load statistics data error:', error);
            this.data = [];
        }
    },

    init() {
        const historyData = this.filterDataByTimeRange(this.data, this.currentTimeRange);

        this.charts.activity = this.createActivityChart(historyData);
        this.charts.distribution = this.createDistributionChart(historyData);
        this.charts.hourly = this.createHourlyChart(historyData);

        this.updateSummaryCards(historyData);
    },

    updateCharts() {
        const historyData = this.filterDataByTimeRange(this.data, this.currentTimeRange);

        if (this.charts.activity) {
            const activityData = this.getTimelineData(historyData);
            this.charts.activity.data.labels = activityData.labels;
            this.charts.activity.data.datasets[0].data = activityData.data;
            this.charts.activity.update();
        }

        if (this.charts.distribution) {
            const distData = this.getEventDistributionData(historyData);
            this.charts.distribution.data.labels = distData.labels;
            this.charts.distribution.data.datasets[0].data = distData.data;
            this.charts.distribution.update();
        }

        if (this.charts.hourly) {
            const hourlyData = this.getHourlyActivityData(historyData);
            this.charts.hourly.data.labels = hourlyData.labels;
            this.charts.hourly.data.datasets[0].data = hourlyData.data;
            this.charts.hourly.update();
        }

        this.updateSummaryCards(historyData);
    },

    filterDataByTimeRange(data, range) {
        const now = new Date();
        let startDate;

        if (range === 'today') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        } else if (range === 'week') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (range === 'month') {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else if (range === 'custom' && this.customStartDate && this.customEndDate) {
            startDate = new Date(this.customStartDate);
            const endDate = new Date(this.customEndDate);
            endDate.setHours(23, 59, 59, 999);
            return data.filter(item => {
                const itemDate = new Date(item.timestamp);
                return itemDate >= startDate && itemDate <= endDate;
            });
        } else {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        return data.filter(item => {
            const itemDate = new Date(item.timestamp);
            return itemDate >= startDate;
        });
    },

    getTimelineData(filteredHistory) {
        const dayMap = {};

        filteredHistory.forEach(item => {
            const date = new Date(item.timestamp);
            const dayKey = `${date.getMonth() + 1}/${date.getDate()}`;
            dayMap[dayKey] = (dayMap[dayKey] || 0) + 1;
        });

        const sortedDays = Object.keys(dayMap).sort((a, b) => {
            const [aMonth, aDay] = a.split('/').map(Number);
            const [bMonth, bDay] = b.split('/').map(Number);
            return (aMonth * 100 + aDay) - (bMonth * 100 + bDay);
        });

        return {
            labels: sortedDays,
            data: sortedDays.map(day => dayMap[day])
        };
    },

    getEventDistributionData(filteredHistory) {
        const typeMap = {
            unlock: 0,
            lock: 0,
            rfid: 0,
            system: 0,
            other: 0
        };

        filteredHistory.forEach(item => {
            const type = item.type || 'other';
            if (typeMap[type] !== undefined) {
                typeMap[type]++;
            } else {
                typeMap.other++;
            }
        });

        return {
            labels: ['Mở khóa', 'Khóa', 'RFID', 'Hệ thống', 'Khác'],
            data: [typeMap.unlock, typeMap.lock, typeMap.rfid, typeMap.system, typeMap.other]
        };
    },

    getHourlyActivityData(filteredHistory) {
        const hourMap = {};
        for (let i = 0; i < 24; i++) {
            hourMap[i] = 0;
        }

        filteredHistory.forEach(item => {
            const date = new Date(item.timestamp);
            const hour = date.getHours();
            hourMap[hour]++;
        });

        return {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            data: Array.from({ length: 24 }, (_, i) => hourMap[i])
        };
    },

    createActivityChart(data) {
        const timelineData = this.getTimelineData(data);
        const ctx = document.getElementById('activityChart').getContext('2d');

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: timelineData.labels,
                datasets: [{
                    label: 'Số sự kiện',
                    data: timelineData.data,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.15)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#8b5cf6',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointHoverBackgroundColor: '#7c3aed',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1a1a2e',
                        bodyColor: '#6b7280',
                        borderColor: '#8b5cf6',
                        borderWidth: 2,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: function (context) {
                                return 'Ngày ' + context[0].label;
                            },
                            label: function (context) {
                                return context.parsed.y + ' sự kiện';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            color: '#6b7280'
                        },
                        grid: {
                            color: 'rgba(107, 114, 128, 0.1)',
                            drawBorder: false
                        }
                    },
                    x: {
                        ticks: {
                            color: '#6b7280'
                        },
                        grid: {
                            color: 'rgba(107, 114, 128, 0.1)',
                            drawBorder: false
                        }
                    }
                }
            }
        });
    },

    createDistributionChart(data) {
        const distData = this.getEventDistributionData(data);
        const ctx = document.getElementById('distributionChart').getContext('2d');

        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: distData.labels,
                datasets: [{
                    data: distData.data,
                    backgroundColor: [
                        'rgba(74, 222, 128, 0.8)',
                        'rgba(248, 113, 113, 0.8)',
                        'rgba(96, 165, 250, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(156, 163, 175, 0.8)'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1a1a2e',
                        bodyColor: '#6b7280',
                        borderColor: 'rgba(139, 92, 246, 0.5)',
                        borderWidth: 2,
                        padding: 12,
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return label + ': ' + value + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
    },

    createHourlyChart(data) {
        const hourlyData = this.getHourlyActivityData(data);
        const ctx = document.getElementById('hourlyChart').getContext('2d');

        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: hourlyData.labels,
                datasets: [{
                    label: 'Số sự kiện',
                    data: hourlyData.data,
                    backgroundColor: 'rgba(139, 92, 246, 0.6)',
                    borderColor: '#8b5cf6',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    },

    updateSummaryCards(filteredHistory) {
        const stats = {
            total: filteredHistory.length,
            unlock: 0,
            lock: 0,
            rfid: 0
        };

        filteredHistory.forEach(item => {
            if (item.type === 'unlock') stats.unlock++;
            else if (item.type === 'lock') stats.lock++;
            else if (item.type === 'rfid') stats.rfid++;
        });

        document.getElementById('totalEvents').textContent = stats.total;
        document.getElementById('totalUnlocks').textContent = stats.unlock;
        document.getElementById('totalLocks').textContent = stats.lock;
        document.getElementById('totalRfid').textContent = stats.rfid;
    }
};


function initEventListeners() {
    DOM.loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = DOM.usernameInput.value.trim();
        const password = DOM.passwordInput.value;

        if (!Auth.login(username, password)) {
            DOM.loginError.style.display = 'block';
            DOM.loginError.textContent = 'Sai tên đăng nhập hoặc mật khẩu';
            DOM.passwordInput.value = '';
            DOM.passwordInput.focus();
        }
    });
    DOM.btnLogout.addEventListener('click', () => Auth.logout());
    DOM.btnConnect.addEventListener('click', () => MQTT.connect());
    DOM.btnUnlock.addEventListener('click', () => Control.unlock());
    DOM.btnLock.addEventListener('click', () => Control.lock());
    DOM.btnPing.addEventListener('click', () => Control.ping());
    DOM.btnBuzz.addEventListener('click', () => Control.buzz());

    DOM.btnStats.addEventListener('click', () => Statistics.open());
    DOM.statsModalClose.addEventListener('click', () => Statistics.close());

    DOM.statsModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('stats-modal-overlay')) {
            Statistics.close();
        }
    });

    DOM.timeRangeSelector.addEventListener('change', (e) => {
        Statistics.currentTimeRange = e.target.value;

        if (e.target.value === 'custom') {
            DOM.customDateRange.style.display = 'flex';
            const today = new Date().toISOString().split('T')[0];
            DOM.customStartDate.value = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            DOM.customEndDate.value = today;
            DOM.customStartDate.max = today;
            DOM.customEndDate.max = today;
        } else {
            DOM.customDateRange.style.display = 'none';
        }

        Statistics.updateCharts();
    });

    DOM.customStartDate.addEventListener('change', () => {
        Statistics.customStartDate = DOM.customStartDate.value;
        DOM.customEndDate.min = DOM.customStartDate.value;
        if (DOM.customEndDate.value) {
            Statistics.updateCharts();
        }
    });

    DOM.customEndDate.addEventListener('change', () => {
        Statistics.customEndDate = DOM.customEndDate.value;
        if (DOM.customStartDate.value) {
            Statistics.updateCharts();
        }
    });

    DOM.historyTabs.forEach(tab => {
        tab.addEventListener('click', () => History.filter(tab.dataset.filter));
    });
    DOM.btnClearHistory.addEventListener('click', () => {
        History.clear();
    });
    DOM.usernameInput.addEventListener('input', () => {
        DOM.loginError.style.display = 'none';
    });
}
document.addEventListener('DOMContentLoaded', () => {
    DOM.deviceStatus.textContent = 'Offline';
    initEventListeners();
    Auth.init();
});
