import { system, world } from "@minecraft/server"
import { bountifulPlantsData } from "./config/bountifulCrops.generated.js"

world.afterEvents.worldLoad.subscribe(() => {
    for (const [seedId, definition] of Object.entries(bountifulPlantsData)) {
        system.sendScriptEvent(
            "utilitycraft:register_plant",
            JSON.stringify({ [seedId]: definition })
        )
    }
})
