class P2PFileTransfer {
    constructor() {
        console.log("That's right, inspect the code to make sure WYSIWYG");
        
        // Detect if we're running on localhost vs production
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocalhost) {
            console.log("📝 Note: ICE candidate errors during local testing are normal and don't affect functionality");
        } else {
            console.log("🌐 Production mode: Enhanced connectivity diagnostics enabled");
        }
        
        this.localConnection = null;
        this.dataChannel = null;
        this.file = null;
        this.isOfferer = false;
        this.isReceiver = false;
        this.isAutoConnecting = false;
        this.receivedData = [];
        this.receivedSize = 0;
        this.totalSize = 0;
        this.receivedFileName = '';
        this.receivedFileType = '';
        this.chunkSize = 16384; // 16KB chunks
        this.pendingAnswerToken = null; // Store answer token when received before offer is created
        this.stunFailures = []; // Track STUN server failures
        this.warnedAboutStun = false; // Prevent multiple warnings
        this.connectionAttempts = 0; // Track retry attempts
        
        // WebRTC Configuration - optimized for speed and reliability
        this.rtcConfig = {
            iceServers: [
                // Primary STUN servers (Google - most reliable)
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                
                // Backup STUN servers
                { urls: 'stun:stun.cloudflare.com:3478' },
                
                // Reliable free TURN servers for NAT traversal
                {
                    urls: [
                        'turn:turn.bistri.com:80',
                        'turn:turn.bistri.com:443',
                        'turn:turn.bistri.com:443?transport=tcp'
                    ],
                    username: 'bismuth',
                    credential: 'bismuth'
                },
                {
                    urls: [
                        'turn:numb.viagenie.ca:3478',
                        'turn:numb.viagenie.ca:3478?transport=tcp'
                    ],
                    username: 'webrtc@live.com',
                    credential: 'muazkh'
                }
            ],
            iceCandidatePoolSize: 10,
            // More aggressive ICE gathering for better connectivity
            iceTransportPolicy: 'all',
            bundlePolicy: 'balanced',
            // Allow relay candidates to ensure TURN servers are used
            iceServersPolicy: 'all'
        };

        this.init();
    }

    init() {
        this.bindEvents();
        this.checkUrlForOffer();
        this.checkConnectivity();
    }

    bindEvents() {
        // Mode toggle event handlers
        document.getElementById('sendMode').addEventListener('change', () => {
            this.switchToSendMode();
        });

        document.getElementById('receiveMode').addEventListener('change', () => {
            this.switchToReceiveMode();
        });

        // Send mode events
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        document.getElementById('createOfferBtn').addEventListener('click', () => {
            this.createOffer();
        });

        document.getElementById('copyUrlBtn').addEventListener('click', () => {
            this.copyToClipboard(document.getElementById('shareUrl').textContent);
        });

        document.getElementById('processAnswerBtn').addEventListener('click', () => {
            this.processAnswer();
        });

        // Receive mode events
        document.getElementById('processLinkBtn').addEventListener('click', () => {
            this.processShareLink();
        });

        document.getElementById('connectBtn').addEventListener('click', () => {
            this.handleAnswer();
        });

        document.getElementById('copyAnswerBtn').addEventListener('click', () => {
            this.copyToClipboard(document.getElementById('answerText').textContent);
        });
    }

    async checkConnectivity() {
        // Quick connectivity test - don't block the UI
        try {
            console.log('🔍 Testing network connectivity...');
            
            // Test STUN servers
            const stunTest = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            
            // Test TURN servers
            const turnTest = new RTCPeerConnection({
                iceServers: [{
                    urls: 'turn:turn.bistri.com:80',
                    username: 'bismuth',
                    credential: 'bismuth'
                }]
            });
            
            // Set timeouts for the tests
            setTimeout(() => {
                console.log('📡 STUN test state:', stunTest.iceGatheringState);
                console.log('📡 TURN test state:', turnTest.iceGatheringState);
                stunTest.close();
                turnTest.close();
            }, 5000);
            
            // Start ICE gathering for both tests
            stunTest.createDataChannel('stun-test');
            const stunOffer = await stunTest.createOffer();
            await stunTest.setLocalDescription(stunOffer);
            
            turnTest.createDataChannel('turn-test');
            const turnOffer = await turnTest.createOffer();
            await turnTest.setLocalDescription(turnOffer);
            
        } catch (error) {
            console.log('📡 Network connectivity test failed:', error.message);
        }
    }

    handleFileSelect(file) {
        if (!file) return;
        
        this.file = file;
        
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = this.formatFileSize(file.size);
        document.getElementById('fileType').textContent = file.type || 'Unknown';
        document.getElementById('fileInfo').hidden = false;
        document.getElementById('createOfferBtn').disabled = false;
        
        this.showStatus('✅ File ready! Now create your share link', 'success');
    }

    async createOffer() {
        try {
            this.isOfferer = true;
            this.localConnection = new RTCPeerConnection(this.rtcConfig);
            
            // Create data channel for file transfer
            this.dataChannel = this.localConnection.createDataChannel('fileTransfer', {
                ordered: true
            });
            
            this.setupDataChannel();
            this.setupConnectionEvents();
            
            const offer = await this.localConnection.createOffer();
            await this.localConnection.setLocalDescription(offer);
            
            // Wait for ICE gathering to complete
            await this.waitForIceGatheringComplete();
            
            const offerData = {
                offer: this.localConnection.localDescription,
                fileName: this.file.name,
                fileSize: this.file.size,
                fileType: this.file.type
            };
            
            const url = window.location.origin + window.location.pathname + '#' + 
                       btoa(JSON.stringify(offerData));
            
            document.getElementById('shareUrl').textContent = url;
            document.getElementById('shareUrlContainer').hidden = false;
            document.getElementById('shareUrlContainer').open = true; // Auto-open the details
            document.getElementById('waitingStatus').hidden = false;
            document.getElementById('manualExchange').hidden = false;
            
            // Minimize the file selection section since it's completed
            document.getElementById('file-section').style.opacity = '0.7';
            document.getElementById('file-section').style.transition = 'opacity 0.3s';
            
            this.showStatus('🎉 Share link ready! Send it to your recipient', 'success');
            
            // If we have a pending answer token, process it automatically
            if (this.pendingAnswerToken) {
                this.showStatus('🔄 Processing received answer automatically...', 'info');
                setTimeout(() => {
                    this.processAnswer();
                    this.pendingAnswerToken = null; // Clear the pending token
                }, 1000);
            }
            
        } catch (error) {
            this.showStatus('Error creating offer: ' + error.message, 'error');
            console.error('Create offer error:', error);
        }
    }

    async processAnswer() {
        try {
            const answerText = document.getElementById('answerInput').value.trim();
            if (!answerText) {
                this.showStatus('Please paste the answer from the receiver', 'error');
                return;
            }

            if (!this.localConnection) {
                this.showStatus('Error: No active connection offer. Please select a file and create an offer first.', 'error');
                return;
            }

            const answerData = JSON.parse(atob(answerText));
            await this.localConnection.setRemoteDescription(answerData.answer);
            
            this.showStatus('🔌 Answer processed! Connection established!', 'success');
            document.getElementById('manualExchange').hidden = true;
            
        } catch (error) {
            this.showStatus('Error processing answer: ' + error.message, 'error');
            console.error('Process answer error:', error);
        }
    }

    checkUrlForOffer() {
        const hash = window.location.hash.slice(1);
        if (hash) {
            try {
                const urlParams = new URLSearchParams(hash);
                
                // Check if this is an answer token for a sender
                if (urlParams.has('answer')) {
                    const answerToken = urlParams.get('answer');
                    document.getElementById('sendMode').checked = true;
                    this.switchToSendMode();
                    
                    // Store the answer token for later use
                    this.pendingAnswerToken = answerToken;
                    
                    // Show instructions to create offer first
                    this.showStatus('📨 Answer received! Select a file and create an offer first', 'info');
                    
                    // Auto-fill the answer field
                    const answerTextarea = document.getElementById('answerInput');
                    answerTextarea.value = answerToken;
                    
                    // Clean URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                    return;
                }
                
                // Otherwise treat as offer data (original behavior)
                const offerData = JSON.parse(atob(hash));
                // Switch to receive mode automatically when a link is opened
                document.getElementById('receiveMode').checked = true;
                this.switchToReceiveMode();
                this.setupReceiver(offerData, true); // Pass autoConnect flag
            } catch (error) {
                this.showStatus('Invalid share link', 'error');
            }
        }
    }

    switchToSendMode() {
        document.getElementById('send-sections').hidden = false;
        document.getElementById('receive-sections').hidden = true;
        this.showStatus('📤 Send mode - Select a file to share', 'info');
    }

    switchToReceiveMode() {
        document.getElementById('send-sections').hidden = true;
        document.getElementById('receive-sections').hidden = false;
        this.showStatus('📥 Receive mode - Paste a share link', 'info');
    }

    processShareLink() {
        const linkText = document.getElementById('shareLinkInput').value.trim();
        if (!linkText) {
            this.showStatus('Please paste a share link', 'error');
            return;
        }

        try {
            // Extract hash from the link
            const url = new URL(linkText);
            const hash = url.hash.slice(1);
            if (!hash) {
                this.showStatus('Invalid share link format', 'error');
                return;
            }

            const offerData = JSON.parse(atob(hash));
            this.setupReceiver(offerData);
        } catch (error) {
            this.showStatus('Invalid share link. Please check and try again.', 'error');
            console.error('Process share link error:', error);
        }
    }

    setupReceiver(offerData, autoConnect = false) {
        this.isReceiver = true;
        this.isAutoConnecting = autoConnect;
        this.receivedFileName = offerData.fileName;
        this.receivedFileType = offerData.fileType;
        this.totalSize = offerData.fileSize;
        
        // Make sure we're in receive mode
        document.getElementById('receiveMode').checked = true;
        this.switchToReceiveMode();
        
        // Hide Step 1 since the connection is already established
        document.getElementById('link-input-section').hidden = true;
        
        this.remoteOffer = offerData.offer;
        
        if (autoConnect) {
            document.getElementById('receiveInfo').innerHTML = `
                <p><strong>📋 Incoming File:</strong></p>
                📄 ${offerData.fileName}<br>
                📏 ${this.formatFileSize(offerData.fileSize)}<br>
                🏷️ ${offerData.fileType || 'Unknown'}<br><br>
                <mark>✅ Ready to connect!</mark>
            `;
            
            this.showStatus('✅ Processing share link...', 'info');
            
            // Start the connection process now that remoteOffer is set
            this.handleAnswer();
        } else {
            // Manual connection flow
            this.isAutoConnecting = false;
            document.getElementById('connectBtn').disabled = false;
            
            document.getElementById('receiveInfo').innerHTML = `
                <p><strong>📋 Incoming File:</strong></p>
                📄 ${offerData.fileName}<br>
                📏 ${this.formatFileSize(offerData.fileSize)}<br>
                🏷️ ${offerData.fileType || 'Unknown'}<br><br>
                <mark>Click "Accept File" below to receive this file</mark>
            `;
            
            this.showStatus('🔗 Connected to sender! Review file and click Accept', 'success');
        }
    }

    async handleAnswer() {
        try {
            if (!this.remoteOffer) {
                this.showStatus('Error: No connection offer available', 'error');
                return;
            }

            this.localConnection = new RTCPeerConnection(this.rtcConfig);
            this.setupConnectionEvents();
            
            // Handle incoming data channel
            this.localConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
            
            await this.localConnection.setRemoteDescription(this.remoteOffer);
            const answer = await this.localConnection.createAnswer();
            await this.localConnection.setLocalDescription(answer);
            
            // Wait for ICE gathering
            await this.waitForIceGatheringComplete();
            
            const answerData = {
                answer: this.localConnection.localDescription
            };
            
            const answerString = btoa(JSON.stringify(answerData));
            document.getElementById('answerText').textContent = answerString;
            document.getElementById('answerDisplay').hidden = false;
            
            // Update status based on whether this is auto-connection or manual
            if (this.isAutoConnecting) {
                // Create a link back to sender with answer token
                const currentUrl = window.location.origin + window.location.pathname;
                const answerUrl = `${currentUrl}#answer=${encodeURIComponent(answerString)}`;
                
                this.showStatus('� Connection ready! Click the link below to automatically send your answer to the sender.', 'info');
                document.getElementById('receiveInfo').innerHTML = `
                    <p><strong>📋 Incoming File Details:</strong></p>
                    📄 <strong>File:</strong> ${this.receivedFileName}<br>
                    📏 <strong>Size:</strong> ${this.formatFileSize(this.totalSize)}<br>
                    🏷️ <strong>Type:</strong> ${this.receivedFileType || 'Unknown'}<br><br>
                    
                    <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 10px 0;">
                        <p><strong>🔗 Automatic Connection:</strong></p>
                        <p>Click this link to automatically connect to the sender:</p>
                        <a href="${answerUrl}" target="_blank" 
                           style="display: inline-block; background: #007acc; color: white; padding: 10px 15px; 
                                  text-decoration: none; border-radius: 5px; margin: 5px 0;">
                           🚀 Connect to Sender Automatically
                        </a>
                        <br><small>This will open the sender's page and automatically establish the connection.</small>
                    </div>
                    
                    <details>
                        <summary>Manual Method (if automatic doesn't work)</summary>
                        <p>Copy the answer code above and paste it into the sender's page.</p>
                    </details>
                `;
            } else {
                this.showStatus('📤 Answer created! Copy the answer code above and send it back to the sender.', 'info');
            }
            
        } catch (error) {
            this.showStatus('Error creating answer: ' + error.message, 'error');
            console.error('Handle answer error:', error);
        }
    }

    setupDataChannel() {
        if (!this.dataChannel) return;
        
        this.dataChannel.onopen = () => {
            this.showStatus('🎉 Connection established! Starting file transfer...', 'success');
            document.getElementById('progressBar').hidden = false;
            
            if (this.isOfferer && this.file) {
                this.sendFile();
            }
        };
        
        this.dataChannel.onmessage = (event) => {
            if (this.isReceiver) {
                this.handleReceivedData(event.data);
            }
        };
        
        this.dataChannel.onerror = (error) => {
            this.showStatus('Data channel error: ' + error, 'error');
            console.error('Data channel error:', error);
        };

        this.dataChannel.onclose = () => {
            this.showStatus('Connection closed', 'info');
        };
    }

    async sendFile() {
        if (!this.file || !this.dataChannel) return;
        
        const totalChunks = Math.ceil(this.file.size / this.chunkSize);
        let chunkIndex = 0;
        
        const sendChunk = () => {
            if (this.dataChannel.readyState !== 'open') return;
            
            const start = chunkIndex * this.chunkSize;
            const end = Math.min(start + this.chunkSize, this.file.size);
            const chunk = this.file.slice(start, end);
            
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    this.dataChannel.send(reader.result);
                    chunkIndex++;
                    
                    const progress = (chunkIndex / totalChunks) * 100;
                    this.updateProgress(progress);
                    
                    if (chunkIndex < totalChunks) {
                        // Use requestAnimationFrame for better performance
                        requestAnimationFrame(sendChunk);
                    } else {
                        this.showStatus('✅ File sent successfully!', 'success');
                    }
                } catch (error) {
                    this.showStatus('Error sending chunk: ' + error.message, 'error');
                    console.error('Send chunk error:', error);
                }
            };
            reader.readAsArrayBuffer(chunk);
        };
        
        sendChunk();
    }

    handleReceivedData(data) {
        this.receivedData.push(data);
        this.receivedSize += data.byteLength;
        
        const progress = (this.receivedSize / this.totalSize) * 100;
        this.updateProgress(progress);
        
        if (this.receivedSize >= this.totalSize) {
            this.completeReceive();
        }
    }

    completeReceive() {
        try {
            const blob = new Blob(this.receivedData, { type: this.receivedFileType });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = this.receivedFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
            
            this.showStatus('🎉 File received and downloaded successfully!', 'success');
        } catch (error) {
            this.showStatus('Error saving file: ' + error.message, 'error');
            console.error('Complete receive error:', error);
        }
    }

    setupConnectionEvents() {
        this.localConnection.oniceconnectionstatechange = () => {
            const state = this.localConnection.iceConnectionState;
            console.log('ICE connection state:', state);
            
            if (state === 'connected' || state === 'completed') {
                // Clear any previous STUN warnings since connection succeeded
                if (this.stunFailures.length > 0) {
                    console.log('✅ Connection established despite STUN server issues');
                }
                this.showStatus('🔗 Peers connected successfully!', 'success');
            } else if (state === 'failed') {
                this.connectionAttempts++;
                console.error('❌ ICE connection failed - network restrictions likely blocking P2P connection');
                console.log(`Connection attempt ${this.connectionAttempts} failed`);
                
                // Try alternative TURN server configuration if available
                if (this.connectionAttempts < 3) {
                    console.log('🔄 Retrying with alternative server configuration...');
                    setTimeout(() => {
                        this.retryConnectionWithFallback();
                    }, 2000);
                } else {
                    console.log('Available TURN servers:', this.rtcConfig.iceServers.filter(server => 
                        server.urls && server.urls.toString().includes('turn:')));
                    this.showNetworkTroubleshooting();
                }
            } else if (state === 'disconnected') {
                this.showStatus('🔌 Connection lost. Try refreshing and creating a new link.', 'error');
            } else if (state === 'checking') {
                this.showStatus('🔍 Finding connection path...', 'info');
            }
        };
        
        this.localConnection.onconnectionstatechange = () => {
            const state = this.localConnection.connectionState;
            console.log('Connection state:', state);
        };

        this.localConnection.onicecandidateerror = (event) => {
            // Track STUN server failures for diagnostics
            if (!this.stunFailures) this.stunFailures = [];
            this.stunFailures.push({
                url: event.url,
                errorCode: event.errorCode,
                errorText: event.errorText,
                timestamp: Date.now()
            });
            
            console.log('STUN server failed:', {
                url: event.url,
                errorCode: event.errorCode,
                errorText: event.errorText
            });
            
            // If multiple STUN servers are failing, show a helpful warning
            if (this.stunFailures.length >= 4 && !this.warnedAboutStun) {
                this.warnedAboutStun = true;
                console.warn('⚠️ Multiple STUN servers failing - connection may only work on same network');
                
                // Show user-friendly message
                const statusEl = document.getElementById('connectionStatus');
                statusEl.innerHTML = `
                    ⚠️ Network connectivity limited - connections work best when both users are on the same WiFi network.<br>
                    <small>Corporate firewalls may block connections between different networks.</small>
                `;
                statusEl.hidden = false;
            }
        };
    }

    waitForIceGatheringComplete() {
        return new Promise((resolve) => {
            if (this.localConnection.iceGatheringState === 'complete') {
                resolve();
            } else {
                const checkState = () => {
                    if (this.localConnection.iceGatheringState === 'complete') {
                        resolve();
                    }
                };
                this.localConnection.addEventListener('icegatheringstatechange', checkState);
                
                // Fallback timeout
                setTimeout(() => {
                    this.localConnection.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }, 10000);
            }
        });
    }

    updateProgress(progress) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        progressBar.value = Math.min(progress, 100);
        progressText.textContent = `${Math.round(Math.min(progress, 100))}% complete`;
    }

    showNetworkTroubleshooting() {
        // Add helpful troubleshooting info to the status area
        const statusEl = document.getElementById('connectionStatus');
        statusEl.innerHTML = `
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 10px 0;">
                <h4 style="margin-top: 0; color: #856404;">🚧 Connection Failed - Network Restrictions</h4>
                <p><strong>The connection failed because:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Your network blocks peer-to-peer connections (common in corporate/school networks)</li>
                    <li>Both devices are behind strict firewalls/NAT</li>
                    <li>Mobile hotspot or ISP restrictions</li>
                    <li>TURN relay servers are unavailable or overloaded</li>
                </ul>
                <p><strong>Try these solutions:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>✅ <strong>Same WiFi network:</strong> Connect both devices to the same WiFi</li>
                    <li>📱 <strong>Mobile hotspot:</strong> One person creates a hotspot, other connects to it</li>
                    <li>🏠 <strong>Home networks:</strong> Usually work better than office/school networks</li>
                    <li>🔄 <strong>Try again:</strong> Sometimes it works on the second attempt</li>
                </ul>
                <button onclick="location.reload()" style="background: #007acc; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin: 10px 5px 0 0;">
                    🔄 Retry Connection
                </button>
                <p><small>P2P file sharing requires direct browser-to-browser connections, which some networks restrict for security.</small></p>
            </div>
        `;
        statusEl.hidden = false;
    }

    showStatus(message, type) {
        const statusEl = document.getElementById('connectionStatus');
        statusEl.textContent = message;
        statusEl.hidden = false;
        
        // Also update the progress text if it's the initial message
        const progressText = document.getElementById('progressText');
        if (progressText.textContent === 'Select a mode above to get started') {
            progressText.textContent = message;
        }
    }

    async retryConnectionWithFallback() {
        try {
            // Close existing connection
            if (this.localConnection) {
                this.localConnection.close();
            }
            
            // Use alternative server configuration for retry
            const fallbackConfig = {
                iceServers: [
                    // Try only Google STUN (most reliable)
                    { urls: 'stun:stun.l.google.com:19302' },
                    // Use alternative TURN server
                    {
                        urls: [
                            'turn:numb.viagenie.ca:3478',
                            'turn:numb.viagenie.ca:3478?transport=tcp'
                        ],
                        username: 'webrtc@live.com',
                        credential: 'muazkh'
                    }
                ],
                iceCandidatePoolSize: 5,
                iceTransportPolicy: 'all',
                bundlePolicy: 'balanced'
            };
            
            this.rtcConfig = fallbackConfig;
            this.showStatus('🔄 Retrying with different servers...', 'info');
            
            // Retry the appropriate connection method
            if (this.isOfferer && this.file) {
                // Retry as sender
                await this.createOffer();
            } else if (this.remoteOffer) {
                // Retry as receiver
                await this.createAnswer();
            }
        } catch (error) {
            console.error('Retry failed:', error);
            this.showNetworkTroubleshooting();
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async copyToClipboard(text) {
        await navigator.clipboard.writeText(text);
        this.showStatus('📋 Copied to clipboard!', 'success');
    }
}

// Initialize the application when page loads
document.addEventListener('DOMContentLoaded', () => {
    new P2PFileTransfer();
});