import memoryTools from "./cards/memory/tools"
import type { ServerContext } from "./types"

export default {
  id: "novaspace.server",
  setup(ctx: ServerContext) {
    return memoryTools.setup(ctx)
  },
}
