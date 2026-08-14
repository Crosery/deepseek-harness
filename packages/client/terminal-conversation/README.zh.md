# @deepseek-ai/dsh-client-terminal-conversation

终端对话插件：绑定当前会话，渲染已定稿的对话节点与流式助手增量，并把
输入行分发到 `session.prompt`（普通文本）或 `session.command`
（斜杠命令）。

它注册共享的对话节点定义与快照构建器（`registerConversationChat`），
与 Web 端共用同一套业务折叠逻辑，并应用一次性启动参数 `task`（打印
模式）、`--model`、`--permission`。

## Model Experience

按原样渲染模型输出：流式文本增量逐字输出，定稿助手消息按 Markdown
渲染，工具结果以暗色预览（上限 2000 字符），轮次错误与 token 上限提示
以彩色行显示。
