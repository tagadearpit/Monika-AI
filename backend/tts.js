'use strict';

const path = require('path');

const ALLOWED_VOICES = new Set(['af_bella', 'af_heart', 'af_sky', 'af_nicole', 'bf_emma']);
const DEFAULT_VOICE = 'af_bella';

let ttsInstance = null;
let initPromise = null;

/**
 * Loads and returns the singleton KokoroTTS instance.
 * Configured with explicit cacheDir, cpu device and q8 dtype for minimal memory footprint.
 */
async function getTTSInstance() {
    if (ttsInstance) return ttsInstance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const { KokoroTTS } = await import('kokoro-js');
        const { env } = await import('@huggingface/transformers');
        const cacheDir = process.env.KOKORO_CACHE_DIR || path.join(process.cwd(), '.cache', 'kokoro');
        env.cacheDir = cacheDir;

        const modelId = process.env.KOKORO_MODEL_ID || 'onnx-community/Kokoro-82M-v1.0-ONNX';
        const dtype = process.env.KOKORO_DTYPE || 'q8';
        const tts = await KokoroTTS.from_pretrained(modelId, {
            dtype,
            device: 'cpu'
        });
        ttsInstance = tts;
        return tts;
    })().catch((err) => {
        initPromise = null;
        throw err;
    });

    return initPromise;
}

/**
 * Eagerly pre-warms the Kokoro model and measures startup readiness.
 * @returns {Promise<{ success: boolean, durationMs: number, modelId: string, dtype: string, error?: Error }>}
 */
async function initTTS() {
    const startedAt = Date.now();
    const modelId = process.env.KOKORO_MODEL_ID || 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const dtype = process.env.KOKORO_DTYPE || 'q8';
    try {
        await getTTSInstance();
        const durationMs = Date.now() - startedAt;
        return { success: true, durationMs, modelId, dtype };
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        return { success: false, durationMs, modelId, dtype, error };
    }
}

/**
 * Converts a Float32Array PCM stream into a standard 16-bit mono WAV buffer.
 * @param {Float32Array} float32Array
 * @param {number} sampleRate
 * @param {number} numChannels
 * @returns {Buffer}
 */
function float32ToWavBuffer(float32Array, sampleRate = 24000, numChannels = 1) {
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = float32Array.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bytesPerSample * 8, 34); // BitsPerSample

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write 16-bit PCM samples
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
        buffer.writeInt16LE(Math.round(val), offset);
    }

    return buffer;
}

/**
 * Generates WAV audio buffer from text and voice using Kokoro-82M.
 * @param {string} text
 * @param {string} voice
 * @returns {Promise<Buffer>}
 */
async function generateSpeech(text, voice = DEFAULT_VOICE) {
    const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE;
    const tts = await getTTSInstance();
    const audio = await tts.generate(text, { voice: selectedVoice });

    // Handle Blob output if toBlob exists
    if (typeof audio.toBlob === 'function') {
        const blob = await audio.toBlob();
        const arrayBuffer = await blob.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    // Handle toWav if available
    if (typeof audio.toWav === 'function') {
        const wavData = await audio.toWav();
        return Buffer.isBuffer(wavData) ? wavData : Buffer.from(wavData);
    }

    // Handle Float32Array raw PCM data
    if (audio.data instanceof Float32Array) {
        return float32ToWavBuffer(audio.data, audio.sampling_rate || 24000);
    }

    // Handle direct buffer/arrayBuffer
    if (Buffer.isBuffer(audio)) {
        return audio;
    }
    if (audio instanceof ArrayBuffer) {
        return Buffer.from(audio);
    }
    if (typeof audio.arrayBuffer === 'function') {
        return Buffer.from(await audio.arrayBuffer());
    }

    throw new Error('Unsupported audio output format from KokoroTTS.');
}

module.exports = {
    generateSpeech,
    ALLOWED_VOICES,
    DEFAULT_VOICE,
    getTTSInstance,
    initTTS
};
