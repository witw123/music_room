import createWasmModule from "./opusscript_native_wasm.cjs"

const maxFrameSize = 48000 * 60 / 1000
const maxPacketSize = 1276 * 3

/**
 * Ogg Opus encoder — browser + Node
 * Uses opusscript (libopus 1.4 WASM) for Opus frame encoding,
 * with a built-in minimal Ogg muxer (RFC 7845).
 *
 * npm install opusscript
 *
 * @param {Object} opts
 * @param {number} opts.sampleRate - input sample rate (any rate; internally resampled to 48kHz)
 * @param {number} [opts.channels=1] - 1 or 2
 * @param {number} [opts.bitrate=64] - kbps
 * @param {string} [opts.application='audio'] - 'voip', 'audio', or 'lowdelay'
 * @returns {{ encode, encodeIndependent, flush, free }}
 *
 * encode(channels: Float32Array[]) -> Uint8Array (Ogg pages for this chunk)
 * flush() -> Uint8Array (complete Ogg Opus file)
 * free() -> void
 */
export default async function opus(opts) {
	let mod = await import('opusscript')
	let OpusScript = mod.default || mod
	let rate = opts.sampleRate
	let nch = opts.channels || 1
	let bitrate = (opts.bitrate || 64) * 1000
	let app = opts.application || 'audio'

	let appConst = app === 'voip' ? OpusScript.Application.VOIP
		: app === 'lowdelay' ? OpusScript.Application.RESTRICTED_LOWDELAY
		: OpusScript.Application.AUDIO

	let OPUS_RATE = 48000
	let FRAME_SIZE = 960 // 20ms at 48kHz
	let ratio = OPUS_RATE / rate

	let enc = await createOpusScript(OpusScript, OPUS_RATE, nch, appConst)
	enc.setBitrate(bitrate)

	let serial = (Math.random() * 0xFFFFFFFF) >>> 0
	let pageSeq = 0
	let granule = 0
	// Keep libopus' codec delay in the Ogg Opus header. Playback units add an
	// explicit preroll so every independently decoded unit has the same length.
	let PRE_SKIP = 3840

	// buffered interleaved Int16 PCM at 48kHz
	let pcmBuf = new Int16Array(0)
	let headerSent = false

	// header pages (BOS + tags)
	let headerPages = [
		oggPage(opusHead(nch, PRE_SKIP, rate), serial, pageSeq++, 0n, 0x02),
		oggPage(opusTags(), serial, pageSeq++, 0n, 0x00)
	]

	return { encode: encodeChunk, encodeIndependent, flush, free }

	// Encode a standalone Ogg Opus unit while reusing the initialized libopus
	// instance. Room playback decodes each unit independently, so the codec and
	// Ogg stream state must be reset for every unit.
	function encodeIndependent(channels) {
		enc.encoderCTL(4028, 0) // OPUS_RESET_STATE
		enc.setBitrate(bitrate)

		let segmentSerial = (Math.random() * 0xFFFFFFFF) >>> 0
		let segmentPageSeq = 0
		let segmentGranule = 0
		let segmentPcmBuf = new Int16Array(0)
		let segmentHeaderSent = false
		let segmentHeaderPages = [
			oggPage(opusHead(nch, PRE_SKIP, rate), segmentSerial, segmentPageSeq++, 0n, 0x02),
			oggPage(opusTags(), segmentSerial, segmentPageSeq++, 0n, 0x00)
		]

		const head = encodeIndependentChunk(channels)
		const tail = flushIndependent()
		return concat([head, tail])

		function encodeIndependentChunk(inputChannels) {
			let len = inputChannels[0].length
			let outLen = Math.round(len * ratio)
			let resampled = new Int16Array(outLen * nch)

			for (let i = 0; i < outLen; i++) {
				let srcF = i / ratio
				for (let c = 0; c < nch; c++) {
					let s = ratio === 1 ? inputChannels[c][i] : lanczos(inputChannels[c], srcF, len)
					s = s < -1 ? -1 : s > 1 ? 1 : s
					resampled[i * nch + c] = Math.round(s * 0x7FFF)
				}
			}

			let previous = segmentPcmBuf
			segmentPcmBuf = new Int16Array(previous.length + resampled.length)
			segmentPcmBuf.set(previous)
			segmentPcmBuf.set(resampled, previous.length)

			let frameSamples = FRAME_SIZE * nch
			let pages = []
			if (!segmentHeaderSent) {
				pages.push(...segmentHeaderPages)
				segmentHeaderSent = true
			}

			while (segmentPcmBuf.length >= frameSamples) {
				let frame = segmentPcmBuf.slice(0, frameSamples)
				segmentPcmBuf = segmentPcmBuf.slice(frameSamples)
				let packet = enc.encode(i16toU8(frame), FRAME_SIZE)
				segmentGranule += FRAME_SIZE
				pages.push(oggPage(packet, segmentSerial, segmentPageSeq++, BigInt(segmentGranule), 0x00))
			}

			return concat(pages)
		}

		function flushIndependent() {
			let pages = []
			if (!segmentHeaderSent) {
				pages.push(...segmentHeaderPages)
				segmentHeaderSent = true
			}

			let frameSamples = FRAME_SIZE * nch
			if (segmentPcmBuf.length > 0) {
				let padded = new Int16Array(frameSamples)
				padded.set(segmentPcmBuf)
				segmentPcmBuf = new Int16Array(0)
				let packet = enc.encode(i16toU8(padded), FRAME_SIZE)
				segmentGranule += FRAME_SIZE
				pages.push(oggPage(packet, segmentSerial, segmentPageSeq++, BigInt(segmentGranule), 0x04))
			} else {
				pages.push(oggPage(new Uint8Array(0), segmentSerial, segmentPageSeq++, BigInt(segmentGranule), 0x04))
			}

			return concat(pages)
		}
	}

	function encodeChunk(channels) {
		let len = channels[0].length
		let outLen = Math.round(len * ratio)
		let resampled = new Int16Array(outLen * nch)

		for (let i = 0; i < outLen; i++) {
			let srcF = i / ratio
			for (let c = 0; c < nch; c++) {
				let s = ratio === 1 ? channels[c][i] : lanczos(channels[c], srcF, len)
				s = s < -1 ? -1 : s > 1 ? 1 : s
				resampled[i * nch + c] = Math.round(s * 0x7FFF)
			}
		}

		// append to PCM buffer
		let prev = pcmBuf
		pcmBuf = new Int16Array(prev.length + resampled.length)
		pcmBuf.set(prev)
		pcmBuf.set(resampled, prev.length)

		// encode full frames
		let frameSamples = FRAME_SIZE * nch
		let pages = []

		// prepend headers on first call
		if (!headerSent) {
			pages.push(...headerPages)
			headerSent = true
		}

		while (pcmBuf.length >= frameSamples) {
			let frame = pcmBuf.slice(0, frameSamples)
			pcmBuf = pcmBuf.slice(frameSamples)

			let buf = i16toU8(frame)
			let packet = enc.encode(buf, FRAME_SIZE)
			granule += FRAME_SIZE
			pages.push(oggPage(packet, serial, pageSeq++, BigInt(granule), 0x00))
		}

		return concat(pages)
	}

	function flush() {
		let pages = []

		// headers if encode() was never called
		if (!headerSent) {
			pages.push(...headerPages)
			headerSent = true
		}

		// encode remaining (zero-padded)
		let frameSamples = FRAME_SIZE * nch
		if (pcmBuf.length > 0) {
			let padded = new Int16Array(frameSamples)
			padded.set(pcmBuf)
			pcmBuf = new Int16Array(0)

			let buf = i16toU8(padded)
			let packet = enc.encode(buf, FRAME_SIZE)
			granule += FRAME_SIZE
			pages.push(oggPage(packet, serial, pageSeq++, BigInt(granule), 0x04))
		} else {
			// empty EOS page
			pages.push(oggPage(new Uint8Array(0), serial, pageSeq++, BigInt(granule), 0x04))
		}

		return concat(pages)
	}

	function free() {
		if (enc) { enc.delete(); enc = null }
		pcmBuf = null
		headerPages = null
	}
}

let browserWasmModulePromise = null

async function createOpusScript(OpusScript, samplingRate, channels, application) {
	// Dedicated workers can use the native WebAssembly build, but opusscript's
	// default loader cannot resolve its .wasm file after Next bundles the worker.
	// Feed the binary explicitly and keep asm.js as a compatibility fallback.
	if (typeof self !== "undefined") {
		try {
			if (!browserWasmModulePromise) {
				browserWasmModulePromise = (async () => {
					const response = await fetch(new URL("./opusscript_native_wasm.wasm", import.meta.url))
					if (!response.ok) throw new Error(`Unable to load Opus WASM (${response.status}).`)
					return createWasmModule({ wasmBinary: await response.arrayBuffer() })
				})()
			}
			return new BrowserOpusScript(
				await browserWasmModulePromise,
				samplingRate,
				channels,
				application
			)
		} catch {
			return new OpusScript(samplingRate, channels, application, { wasm: false })
		}
	}
	return new OpusScript(samplingRate, channels, application, { wasm: true })
}

class BrowserOpusScript {
	constructor(native, samplingRate, channels, application) {
		this.native = native
		this.channels = channels
		this.handler = new native.OpusScriptHandler(samplingRate, channels, application)
		this.inPCMLength = maxFrameSize * channels * 2
		this.inPCMPointer = native._malloc(this.inPCMLength)
		this.inPCM = native.HEAPU16.subarray(
			this.inPCMPointer,
			this.inPCMPointer + this.inPCMLength
		)
		this.inOpusPointer = native._malloc(maxPacketSize)
		this.outOpusPointer = native._malloc(maxPacketSize)
	}

	encode(buffer, frameSize) {
		this.inPCM.set(buffer)
		const length = this.handler._encode(
			this.inPCM.byteOffset,
			buffer.length,
			this.outOpusPointer,
			frameSize
		)
		if (length < 0) throw new Error("Encode error: " + length)
		return new Uint8Array(
			this.native.HEAPU8.buffer,
			this.outOpusPointer,
			length
		).slice()
	}

	encoderCTL(control, value) {
		const result = this.handler._encoder_ctl(control, value)
		if (result < 0) throw new Error("Encoder CTL error: " + result)
	}

	setBitrate(bitrate) {
		this.encoderCTL(4002, bitrate)
	}

	delete() {
		this.native.OpusScriptHandler.destroy_handler(this.handler)
		this.native._free(this.inPCMPointer)
		this.native._free(this.inOpusPointer)
		this.native._free(this.outOpusPointer)
		this.handler = null
	}
}

// Int16Array -> Uint8Array (same underlying bytes)
function i16toU8(i16) {
	return new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength)
}

// Lanczos-3 windowed sinc interpolation
function lanczos(ch, x, len) {
	let a = 3, sum = 0, wsum = 0
	let i0 = Math.floor(x) - a + 1
	let i1 = Math.floor(x) + a
	for (let i = i0; i <= i1; i++) {
		let d = x - i
		let w = d === 0 ? 1 : a * Math.sin(Math.PI * d) * Math.sin(Math.PI * d / a) / (Math.PI * Math.PI * d * d)
		let idx = i < 0 ? 0 : i >= len ? len - 1 : i
		sum += ch[idx] * w
		wsum += w
	}
	return wsum ? sum / wsum : 0
}


// --- Ogg muxer ---

function oggPage(payload, serial, seq, granule, flags) {
	let segs = []
	let rem = payload.length
	while (rem >= 255) { segs.push(255); rem -= 255 }
	segs.push(rem)

	let hdrLen = 27 + segs.length
	let page = new Uint8Array(hdrLen + payload.length)
	let dv = new DataView(page.buffer)

	page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53 // "OggS"
	page[4] = 0       // version
	page[5] = flags

	// granule (int64 LE)
	dv.setUint32(6, Number(granule & 0xFFFFFFFFn), true)
	dv.setUint32(10, Number((granule >> 32n) & 0xFFFFFFFFn), true)

	dv.setUint32(14, serial, true)
	dv.setUint32(18, seq, true)
	dv.setUint32(22, 0, true) // CRC placeholder

	page[26] = segs.length
	for (let i = 0; i < segs.length; i++) page[27 + i] = segs[i]
	page.set(payload, hdrLen)

	dv.setUint32(22, oggCrc(page), true)
	return page
}

function opusHead(ch, preSkip, inputRate) {
	let b = new Uint8Array(19)
	let d = new DataView(b.buffer)
	set8(b, 0, 'OpusHead')
	b[8] = 1          // version
	b[9] = ch          // channels
	d.setUint16(10, preSkip, true)
	d.setUint32(12, inputRate, true)
	d.setInt16(16, 0, true) // output gain
	b[18] = 0          // channel mapping family 0
	return b
}

function opusTags() {
	let v = 'audio-encode'
	let b = new Uint8Array(8 + 4 + v.length + 4)
	let d = new DataView(b.buffer)
	set8(b, 0, 'OpusTags')
	d.setUint32(8, v.length, true)
	for (let i = 0; i < v.length; i++) b[12 + i] = v.charCodeAt(i)
	d.setUint32(12 + v.length, 0, true) // 0 comments
	return b
}

function set8(buf, off, str) {
	for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i)
}

// Ogg CRC32: direct, poly=0x04C11DB7, init=0, xorOut=0
let crcTbl
function oggCrc(data) {
	if (!crcTbl) {
		crcTbl = new Uint32Array(256)
		for (let i = 0; i < 256; i++) {
			let r = i << 24
			for (let j = 0; j < 8; j++) {
				r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1)
				r >>>= 0
			}
			crcTbl[i] = r >>> 0
		}
	}
	let crc = 0
	for (let i = 0; i < data.length; i++)
		crc = ((crc << 8) ^ crcTbl[((crc >>> 24) ^ data[i]) & 0xFF]) >>> 0
	return crc >>> 0
}

function concat(arrays) {
	if (!arrays.length) return new Uint8Array(0)
	if (arrays.length === 1) return arrays[0]
	let n = 0
	for (let a of arrays) n += a.length
	let out = new Uint8Array(n), off = 0
	for (let a of arrays) { out.set(a, off); off += a.length }
	return out
}
