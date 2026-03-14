"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "agent";
  text: string;
};

export default function Home() {
  const [status, setStatus] = useState("Disconnected");
  const [messages, setMessages] = useState<Message[]>([]); // 👈 New state for chat
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null); // 👈 For auto-scrolling

  // Scroll to bottom every time a new message arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startStreaming = async () => {
    try {
      setStatus("Requesting Microphone...");
      setMessages([]); // Clear chat history on new session

      const audioContext = new (window.AudioContext || window.AudioContext)({
        sampleRate: 16000, 
      });
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioContextRef.current = audioContext;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      setStatus("Connecting to Server...");
      const ws = new WebSocket("ws://localhost:3000/api/voice");
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Connected & Streaming...");

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const float32Array = e.inputBuffer.getChannelData(0);
            const int16Array = new Int16Array(float32Array.length);
            for (let i = 0; i < float32Array.length; i++) {
              int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32768));
            }
            ws.send(int16Array.buffer);
          }
        };
      };

      let nextPlayTime = 0;
      ws.onmessage = async (event) => {
        // 1. If the message is an audio buffer, play it
        if (event.data instanceof ArrayBuffer && audioContextRef.current) {
           const ctx = audioContextRef.current;
           ctx.decodeAudioData(event.data, (buffer) => {
               const playSource = ctx.createBufferSource();
               playSource.buffer = buffer;
               playSource.connect(ctx.destination);
               
               if (ctx.currentTime > nextPlayTime) nextPlayTime = ctx.currentTime;
               playSource.start(nextPlayTime);
               nextPlayTime += buffer.duration;
           });
        } 
        // 2. If the message is a text string, add it to our chat UI
        else if (typeof event.data === "string") {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === "transcript") {
                    setMessages((prev) => [...prev, { role: parsed.role, text: parsed.text }]);
                }
            } catch (e) {
                console.error("Failed to parse message:", e);
            }
        }
      };

      ws.onclose = () => stopStreaming();

    } catch (err) {
      console.error("Error starting stream:", err);
      setStatus("Microphone access denied or error occurred.");
      stopStreaming();
    }
  };

  const stopStreaming = () => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    
    if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
    }
    
    wsRef.current?.close();
    setStatus("Stopped");
  };

  return (
    <main className="flex flex-col items-center min-h-screen p-10 font-sans max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Sarvam Voice Agent</h1>
      
      <div className="space-x-4 mb-6">
        <button onClick={startStreaming} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-colors">
          Start Talking
        </button>
        <button onClick={stopStreaming} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md transition-colors">
          Stop
        </button>
      </div>
      
      <div className="text-sm font-medium bg-gray-100 px-4 py-2 rounded-md border border-gray-200 w-full text-center mb-6">
        Status: <span className={status.includes("Connected") ? "text-green-600" : "text-gray-700"}>{status}</span>
      </div>

      {/* --- LIVE CHAT HISTORY UI --- */}
      <div className="w-full flex-1 border border-gray-300 rounded-xl bg-gray-50 p-4 overflow-y-auto flex flex-col gap-4 min-h-100 max-h-150 shadow-inner">
        {messages.length === 0 ? (
          <p className="text-gray-400 text-center m-auto">Conversation will appear here once you start talking...</p>
        ) : (
          messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`p-3 rounded-xl max-w-[75%] shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white self-end rounded-tr-none' 
                  : 'bg-white border border-gray-200 text-gray-800 self-start rounded-tl-none'
              }`}
            >
              <span className={`font-bold text-xs uppercase block mb-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                {msg.role === 'user' ? 'You' : 'Aisha'}
              </span>
              <p className="leading-relaxed">{msg.text}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </main>
  );
}