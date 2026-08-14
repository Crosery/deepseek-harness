# @deepseek-ai/dsh-client-terminal-connection

终端客户端平面的传输层：以进程内传输提供 `ctx.connection`（与 Web 传输层
提供的服务一致）。

`new InProcessApiClient(toFetchHandler(ctx.apiProxy))` 让一元调用、两条
SSE 事件流与 respond 通道都经由同一个 fetch 形态的处理器——零 socket、零
监听、零网络。cli 运行器负责组合该处理器并以 `ctx.cliTransport` 注入。

## Model Experience

不涉及模型：本包是纯传输适配层。
