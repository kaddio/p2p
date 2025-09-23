class P2PFileTransfer {
    constructor() {
        this.localConnection = null;
        this.dataChannel = null;
        this.file = null;
        this.isOfferer = false;
        this.isReceiver = false;
        this.receivedData = [];
        this.receivedSize = 0;
        this.totalSize = 0;
        this.receivedFileName = '';
        this.receivedFileType = '';
        this.chunkSize = 16384; // 16KB chunks
        
        // WebRTC Configuration with public STUN servers for NAT traversal
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' }
            ]
        };

        this.init();
    }

    init() {
        this.bindEvents();
        this.checkUrlForOffer();
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

    handleFileSelect(file) {
        if (!file) return;
        
        this.file = file;
        
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = this.formatFileSize(file.size);
        document.getElementById('fileType').textContent = file.type || 'Unknown';
        document.getElementById('fileInfo').hidden = false;
        document.getElementById('createOfferBtn').disabled = false;
        
        this.showStatus('✅ File selected successfully! Now click "Create Share Link"', 'success');
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
            document.getElementById('waitingStatus').hidden = false;
            document.getElementById('manualExchange').hidden = false;
            
            this.showStatus('🎉 Share link created! Send this link to the person you want to share with.', 'success');
            
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
                const offerData = JSON.parse(atob(hash));
                // Switch to receive mode automatically when a link is opened
                document.getElementById('receiveMode').checked = true;
                this.switchToReceiveMode();
                this.setupReceiver(offerData);
            } catch (error) {
                this.showStatus('Invalid share link', 'error');
            }
        }
    }

    switchToSendMode() {
        document.getElementById('send-sections').hidden = false;
        document.getElementById('receive-sections').hidden = true;
        document.getElementById('sendInstructions').hidden = false;
        document.getElementById('receiveInstructions').hidden = true;
        this.showStatus('📤 Send mode activated. Select a file to share.', 'info');
    }

    switchToReceiveMode() {
        document.getElementById('send-sections').hidden = true;
        document.getElementById('receive-sections').hidden = false;
        document.getElementById('sendInstructions').hidden = true;
        document.getElementById('receiveInstructions').hidden = false;
        this.showStatus('📥 Receive mode activated. Paste a share link to connect.', 'info');
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

    setupReceiver(offerData) {
        this.isReceiver = true;
        this.receivedFileName = offerData.fileName;
        this.receivedFileType = offerData.fileType;
        this.totalSize = offerData.fileSize;
        
        // Make sure we're in receive mode
        document.getElementById('receiveMode').checked = true;
        this.switchToReceiveMode();
        
        document.getElementById('connectBtn').disabled = false;
        
        document.getElementById('receiveInfo').innerHTML = `
            <p><strong>📋 Incoming File Details:</strong></p>
            📄 <strong>File:</strong> ${offerData.fileName}<br>
            📏 <strong>Size:</strong> ${this.formatFileSize(offerData.fileSize)}<br>
            🏷️ <strong>Type:</strong> ${offerData.fileType || 'Unknown'}<br><br>
            <mark>Click "Accept File Transfer" below to receive this file</mark>
        `;
        
        this.remoteOffer = offerData.offer;
        this.showStatus('🔗 Connected to sender! Review file details and click Accept.', 'success');
    }

    async handleAnswer() {
        try {
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
            
            this.showStatus('📤 Answer created! Copy the answer code above and send it back to the sender.', 'info');
            
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
                this.showStatus('🔗 Peers connected successfully!', 'success');
            } else if (state === 'failed' || state === 'disconnected') {
                this.showStatus('❌ Connection failed or lost. Try refreshing and creating a new link.', 'error');
            }
        };
        
        this.localConnection.onconnectionstatechange = () => {
            const state = this.localConnection.connectionState;
            console.log('Connection state:', state);
        };

        this.localConnection.onicecandidateerror = (event) => {
            console.error('ICE candidate error:', event);
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

    showStatus(message, type) {
        const statusEl = document.getElementById('connectionStatus');
        statusEl.textContent = message;
        statusEl.hidden = false;
        
        // Also update the progress text if it's just "Ready to transfer..."
        const progressText = document.getElementById('progressText');
        if (progressText.textContent === 'Ready to transfer...') {
            progressText.textContent = message;
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