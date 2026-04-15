export { captureWechatWindow, takeWeChatScreenshot, calculateRedDotPercentage } from './screenshot-utils'
export { AppType } from './types'
export { getWindowInfo, getWechatWindowInfo } from './window-utils'
export { sendReplyAction, activeUnreadByClickAction, clickUnreadContactAction } from './input-utils'
export { compareImages, hasImageChanged } from './image-compare'
export { hasUnreadMessage, isChatContactUnread } from './has-unread'
export {
  parseBBoxes, parsePoint,
  bboxToScreenCoords, pointToScreenCoords, bboxToCropBounds,
  detectUnreadArea, getUnreadArea,
  getLayoutCache, setLayoutCache, clearLayoutCache,
  type BBox, type LayoutCache
} from './vision-utils'
