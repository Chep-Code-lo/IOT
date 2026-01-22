const CONFIG = {
    api: {
        baseUrl: '/api'

    },
    mqtt: {
        url: 'wss://iot.x10.network/mqtt',
        username: 'esp32user',
        password: 'esp32pass123',
        deviceId: 'esp32_01'
    },
    auth: {
        defaultUsername: 'admin',
        defaultPassword: 'admin123'
    },
    storage: {
        tokenKey: 'iot_token',
        sessionKey: 'iot_session'
    }
};

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

    logStream: document.getElementById('logStream'),
    historyList: document.getElementById('historyList'),
    historyTabs: document.querySelectorAll('.history-tab'),
    btnClearHistory: document.getElementById('btnClearHistory'),

    toastContainer: document.getElementById('toastContainer')
};

const Auth = {
    async init() {
        const token = localStorage.getItem(CONFIG.storage.tokenKey);
        if (token) {
            try {
                const response = await API.get('/auth/verify');
                if (response.success) {
                    currentUser = response.data.user;
                    this.showDashboard();
                    return;
                }
            } catch (error) {
                console.error('Token verification failed:', error);
                localStorage.removeItem(CONFIG.storage.tokenKey);
            }
        }
        this.showLogin();
    },

    async login(username, password) {
        try {
            const response = await API.post('/auth/login', { username, password });

            if (response.success) {
                localStorage.setItem(CONFIG.storage.tokenKey, response.data.token);
                currentUser = response.data.user;
                this.showDashboard();
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

        currentUser = null;
        localStorage.removeItem(CONFIG.storage.tokenKey);
        localStorage.removeItem(CONFIG.storage.sessionKey);

        if (mqttClient && mqttClient.connected) {
            mqttClient.end();
        }

        this.showLogin();
        Toast.show('info', 'Đã đăng xuất', 'Bạn đã đăng xuất khỏi hệ thống');
    },

    showLogin() {
        DOM.loginPage.style.display = 'flex';
        DOM.dashboard.classList.remove('active');
        DOM.usernameInput.focus();
    },

    showDashboard() {
        DOM.loginPage.style.display = 'none';
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
            DOM.deviceStatus.textContent = 'Online';
        } else {
            DOM.mqttStatus.className = 'status-badge disconnected';
            DOM.mqttStatus.textContent = 'DISCONNECTED';
            DOM.mqttStatusText.textContent = 'Chưa kết nối';
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
        const btn = DOM.btnPing;
        btn.classList.add('sending');

        MQTT.sendCommand('PING');

        Toast.show('info', 'PING', 'Đã gửi yêu cầu ping đến thiết bị');

        setTimeout(() => btn.classList.remove('sending'), 500);
    },

    buzz(durationMs = 300) {
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
        try {
            const response = await API.get('/history?limit=100');
            if (response.success) {
                this.items = response.data;
                this.render();
            }
        } catch (error) {
            console.error('Load history error:', error);
            // Fallback to empty if API fails
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
    initEventListeners();
    Auth.init();
});
