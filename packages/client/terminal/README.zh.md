# @deepseek-ai/dsh-client-terminal

终端客户端平面内核：ANSI 输出器、增量 Markdown 渲染器、串行化的行输入，
以及所有终端功能插件共享的 `ctx.terminal` 服务。

内核本身不渲染内容：功能插件注册输入处理器并经由共享输出器写入，正如
Web 端外壳持有渲染树、ui-* 插件持有各自座位。

## Model Experience

不涉及模型：纯展示内核。
