/**
 * DOM 注入點。解析邏輯（svg-parse / build-tree / validate-rules）必須在兩個環境跑：
 * Node（CI、建置）用 linkedom，瀏覽器（線上編輯器）用原生 DOMParser。把「怎麼取得 Document」
 * 抽成參數，同一份規則就不必寫兩遍、也不會兩邊漂移。
 *
 * 注意：src/lib/ 底下一律不得 import linkedom 或任何 node: 內建模組——那會讓瀏覽器打包失敗。
 * Node 端的實作留在 tools/lib/dom.ts。
 */
export type XmlParser = (text: string) => Document;

/** 瀏覽器端實作。image/svg+xml 與 CI 端 linkedom 的解析模式一致。 */
export const parseXmlInBrowser: XmlParser = (text) =>
  new DOMParser().parseFromString(text, 'image/svg+xml');
