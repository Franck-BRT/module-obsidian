export { LlmClient, obsidianTransport, describeHttp, type HttpTransport } from './client'
export {
  buildChatBody,
  buildEmbeddingBody,
  cosine,
  joinUrl,
  LlmError,
  parseJsonContent,
  readChatContent,
  readEmbeddings,
  readModels,
  type ChatMessage,
  type ChatRequest,
  type LlmFailure
} from './protocol'
