import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import { checkAvailability, bookAppointment } from './database.js';

dotenv.config({ path: '.env.local' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

const checkAvailabilityTool: FunctionDeclaration = {
    name: "checkAvailability",
    description: "Check which doctors and time slots are available on a specific date.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            date: { type: SchemaType.STRING, description: "The date to check in YYYY-MM-DD format." }
        },
        required: ["date"]
    }
};

const bookAppointmentTool: FunctionDeclaration = {
    name: "bookAppointment",
    description: "Book an appointment for a patient.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            patientName: { type: SchemaType.STRING, description: "Name of the patient." },
            date: { type: SchemaType.STRING, description: "Date in YYYY-MM-DD format." },
            time: { type: SchemaType.STRING, description: "Time of the appointment (e.g., '10:00 AM')." },
            doctor: { type: SchemaType.STRING, description: "Name of the doctor." }
        },
        required: ["patientName", "date", "time", "doctor"]
    }
};

export function createLLMSession() {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: "You are a helpful medical clinic receptionist. Keep your answers brief and conversational. You speak Hindi and English.",
        tools: [{ functionDeclarations: [checkAvailabilityTool, bookAppointmentTool] }]
    });

    const chatSession = model.startChat({ history: [] });

    async function* getLLMResponseStream(prompt: string) {
        const result = await chatSession.sendMessageStream(prompt);
        let buffer = "";

        for await (const chunk of result.stream) {
            const call = chunk.functionCalls()?.[0];
            if (call) {
                let functionResponse: any = {};
                if (call.name === "checkAvailability") {
                    const args = call.args as { date: string };
                    functionResponse = checkAvailability(args.date);
                } else if (call.name === "bookAppointment") {
                    const args = call.args as { patientName: string, date: string, time: string, doctor: string };
                    functionResponse = bookAppointment(args.patientName, args.date, args.time, args.doctor);
                }

                const secondResult = await chatSession.sendMessageStream([{
                    functionResponse: { name: call.name, response: functionResponse as object }
                }]);

                for await (const secondChunk of secondResult.stream) {
                    buffer += secondChunk.text();
                    const match = buffer.match(/(.*?[.?!])\s+(.*)/);
                    if (match && match[1] !== undefined && match[2] !== undefined) {
                        yield match[1];
                        buffer = match[2];
                    }
                }
                break;
            }

            const text = chunk.text();
            if (text) {
                buffer += text;
                const match = buffer.match(/(.*?[.?!])\s+(.*)/);
                if (match && match[1] !== undefined && match[2] !== undefined) {
                    yield match[1];
                    buffer = match[2];
                }
            }
        }

        if (buffer.trim()) yield buffer.trim();
    }

    return { getLLMResponseStream };
}