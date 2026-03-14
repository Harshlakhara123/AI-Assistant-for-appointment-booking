import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createLLMSession } from './llm.js';

dotenv.config({ path: '.env.local' });

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url!, true);
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('Internal Server Error');
        }
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const { pathname } = parse(request.url || '', true);
        if (pathname === '/api/voice') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            return;
        }
    });

    wss.on('connection', (clientWs: WebSocket) => {
        console.log('🎙️ User connected. Initializing Sarvam AI...');

        const llmSession = createLLMSession();

        const sarvamSttUrl = 'wss://api.sarvam.ai/speech-to-text/ws?language-code=hi-IN&model=saaras:v3&input_audio_codec=pcm_s16le';
        const sarvamStt = new WebSocket(sarvamSttUrl, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY?.trim() as string }
        });

        sarvamStt.on('error', (err) => console.error('❌ Sarvam STT Error:', err.message));
        sarvamStt.on('open', () => console.log('✅ Sarvam STT Connected'));

        const sarvamTtsUrl = 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3';
        const sarvamTts = new WebSocket(sarvamTtsUrl, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY?.trim() as string }
        });

        sarvamTts.on('error', (err) => console.error('❌ Sarvam TTS Error:', err.message));
        
        sarvamTts.on('open', () => {
            sarvamTts.send(JSON.stringify({
                type: "config",
                data: {
                    target_language_code: "hi-IN",
                    speaker: "ritu" // 👈 Changed to a female voice
                }
            }));
            console.log('✅ Sarvam TTS Connected');
        });

        sarvamStt.on('message', async (data) => {
            const response = JSON.parse(data.toString());
            const transcript = response.data?.transcript;
            
            if (transcript && transcript.trim() !== '' && response.type === 'data') {
                console.log(`🗣️ User: ${transcript}`);
                
                try {
                    // 👉 Send the user's words to the frontend UI
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ type: "transcript", role: "user", text: transcript }));
                    }

                    const responseStream = llmSession.getLLMResponseStream(transcript);
                    
                    for await (const sentence of responseStream) {
                        console.log(`🤖 Agent: ${sentence}`);
                        
                        // 👉 Send the AI's words to the frontend UI
                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.send(JSON.stringify({ type: "transcript", role: "agent", text: sentence }));
                        }

                        if (sarvamTts.readyState === WebSocket.OPEN) {
                            sarvamTts.send(JSON.stringify({ 
                                type: "text", 
                                data: { text: sentence } 
                            }));
                        }
                    }
                } catch (error) {
                    console.error('Error generating LLM response:', error);
                }
            }
        });

        sarvamTts.on('message', (data) => {
            const response = JSON.parse(data.toString());
            const audioBase64 = response.data?.audio || response.audio;
            if (audioBase64) {
                const audioBuffer = Buffer.from(audioBase64, 'base64');
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(audioBuffer);
                }
            }
        });

        clientWs.on('message', (message: Buffer) => {
            if (sarvamStt.readyState === WebSocket.OPEN) {
                const base64Audio = message.toString('base64');
                sarvamStt.send(JSON.stringify({ 
                    audio: { 
                        data: base64Audio,
                        sample_rate: 16000,
                        encoding: "audio/wav" 
                    } 
                }));
            }
        });

        clientWs.on('close', () => {
            console.log('User disconnected. Cleaning up...');
            if (sarvamStt.readyState === WebSocket.OPEN) sarvamStt.close();
            if (sarvamTts.readyState === WebSocket.OPEN) sarvamTts.close();
        });
    });

    server.listen(port, () => {
        console.log(`🚀 Next.js + Voice Server running on http://${hostname}:${port}`);
    });
});