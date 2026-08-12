import { system } from "@minecraft/server"
import "./register_bonsais.js"
import { CROP_COMPONENT } from "./components/crop.js"
import {
    INTERACT_COMPONENT,
    PEDESTAL_COMPONENT
} from "./components/pedestal.js"

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    blockComponentRegistry.registerCustomComponent("utilitycraft:crop", CROP_COMPONENT)
    blockComponentRegistry.registerCustomComponent("utilitycraft:interact", INTERACT_COMPONENT)
    blockComponentRegistry.registerCustomComponent("utilitycraft:pedestal", PEDESTAL_COMPONENT)
})
