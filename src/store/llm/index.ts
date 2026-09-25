export {
  LlmClient,
  obsidianTransport,
  describeHttp,
  forgetUnstreamable,
  type HttpTransport,
  type StreamOutcome,
  type StreamTransport
} from './client'
export {
  buildChatBody,
  buildEmbeddingBody,
  cosine,
  joinUrl,
  LlmError,
  parseJsonContent,
  readChatContent,
  readEmbeddings,
  readDelta,
  readModels,
  readSseEvents,
  type ChatMessage,
  type ChatRequest,
  type LlmFailure
} from './protocol'
