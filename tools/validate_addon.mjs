import { access, readFile, readdir } from "node:fs/promises"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const toolsDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(toolsDirectory, "..")
const bpRoot = join(projectRoot, "BP")
const rpRoot = join(projectRoot, "RP")
const bonsaiTemplatePath = join(toolsDirectory, "data", "bonsai_entity.template.json")
const errors = []

const jsonFiles = (await collectFiles(projectRoot))
    .filter(path => extname(path) === ".json")
    .filter(path => !path.includes(`${join(projectRoot, "node_modules")}\\`))
const documents = new Map()

for (const path of jsonFiles) {
    try {
        documents.set(path, JSON.parse(await readFile(path, "utf8")))
    } catch (error) {
        errors.push(`${relative(projectRoot, path)}: invalid JSON (${error.message})`)
    }
}

const catalogPath = join(toolsDirectory, "data", "bountiful_crops.json")
const catalog = documents.get(catalogPath)
const crops = catalog?.crops ?? []
if (crops.length !== 32) errors.push(`Expected 32 crops, found ${crops.length}`)

const identifiers = new Set()
const typedIdentifiers = new Set()
const recipeIds = new Set()
for (const [path, document] of documents) {
    if (!path.startsWith(bpRoot)) continue

    for (const rootKey of ["minecraft:block", "minecraft:item", "minecraft:entity"]) {
        const identifier = document[rootKey]?.description?.identifier
        if (!identifier) continue
        const typedIdentifier = `${rootKey}:${identifier}`
        if (typedIdentifiers.has(typedIdentifier)) {
            errors.push(`Duplicate ${rootKey} definition: ${identifier}`)
        }
        typedIdentifiers.add(typedIdentifier)
        identifiers.add(identifier)
    }

    const recipe = Object.entries(document).find(([key]) => key.startsWith("minecraft:recipe_"))?.[1]
    const recipeId = recipe?.description?.identifier
    if (recipeId) {
        if (recipeIds.has(recipeId)) errors.push(`Duplicate recipe identifier: ${recipeId}`)
        recipeIds.add(recipeId)
    }
}

const requiredIds = [
    ...crops.flatMap(crop => [
        crop.cropId,
        crop.seedId,
        `bountiful_crops:${crop.key}_bonsai`
    ]),
    "utilitycraft:base_seeds",
    "utilitycraft:yellow_soil",
    "utilitycraft:red_soil",
    "utilitycraft:blue_soil",
    "utilitycraft:black_soil",
    "utilitycraft:water_ball",
    "utilitycraft:lava_ball",
    "utilitycraft:honey_ball",
    "utilitycraft:diamond_shard",
    "utilitycraft:emerald_shard",
    "utilitycraft:netherite_nugget",
    "utilitycraft:nether_star_fragment",
    "utilitycraft:shulker_shell_shard",
    "utilitycraft:totem_shard",
    "utilitycraft:wither_skull_shard",
    "utilitycraft:pedestal",
    "utilitycraft:accelerator_clock",
    "utilitycraft:diamond_accelerator_clock",
    "utilitycraft:nether_star_accelerator_clock",
    "utilitycraft:pedestal_area_outline"
]
for (const identifier of requiredIds) {
    if (!identifiers.has(identifier)) errors.push(`Missing definition: ${identifier}`)
}

for (const crop of crops) {
    for (const drop of crop.drops ?? []) {
        if (drop.item.startsWith("utilitycraft:") && !identifiers.has(drop.item)) {
            errors.push(`Missing custom drop ${drop.item} for ${crop.cropId}`)
        }
    }
}

for (const [path, document] of documents) {
    if (!path.startsWith(bpRoot)) continue
    checkCustomReferences(document, `${relative(projectRoot, path)}:root`)
}

const cropLootFiles = await jsonFileCount(join(bpRoot, "loot_tables", "bc", "crops"))
const seedLootFiles = await jsonFileCount(join(bpRoot, "loot_tables", "bc", "seeds"))
const behaviorBonsaiFiles = await jsonFileCount(join(bpRoot, "entities", "bonsais"))
const clientBonsaiFiles = await jsonFileCount(join(rpRoot, "entity", "bonsais"))
if (cropLootFiles !== crops.length) {
    errors.push(`Expected ${crops.length} crop loot tables, found ${cropLootFiles}`)
}
if (seedLootFiles !== crops.length) {
    errors.push(`Expected ${crops.length} seed loot tables, found ${seedLootFiles}`)
}
if (behaviorBonsaiFiles !== crops.length) {
    errors.push(`Expected ${crops.length} bonsai behavior entities, found ${behaviorBonsaiFiles}`)
}
if (clientBonsaiFiles !== crops.length) {
    errors.push(`Expected ${crops.length} bonsai client entities, found ${clientBonsaiFiles}`)
}

const bonsaiTemplateSource = await readFile(bonsaiTemplatePath, "utf8")
for (const crop of crops) {
    const identifier = `bountiful_crops:${crop.key}_bonsai`
    const path = join(bpRoot, "entities", "bonsais", `${crop.key}_bonsai.json`)
    const source = await readFile(path, "utf8")
    const expected = JSON.parse(
        bonsaiTemplateSource.replace("__BONSAI_IDENTIFIER__", identifier)
    )
    const actual = documents.get(path)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(`${relative(projectRoot, path)} does not match the bonsai BP template`)
    }
    if (
        !source.includes('"default": 60.0') ||
        !source.includes("10.0") ||
        !source.includes("600.0")
    ) {
        errors.push(`${relative(projectRoot, path)} must preserve float literals`)
    }
}

await validateAtlas(join(rpRoot, "textures", "terrain_texture.json"), rpRoot)
await validateAtlas(join(rpRoot, "textures", "item_texture.json"), rpRoot)
await validateResourceReferences()

const allText = (await Promise.all(
    [...await collectFiles(bpRoot), ...await collectFiles(rpRoot)]
        .filter(path => [".json", ".js", ".mjs", ".lang"].includes(extname(path)))
        .map(path => readFile(path, "utf8"))
)).join("\n")
if (allText.includes("twm:")) errors.push("Legacy twm: identifiers remain in the rebuilt add-on")

const bpManifest = documents.get(join(bpRoot, "manifest.json"))
const rpManifest = documents.get(join(rpRoot, "manifest.json"))
const bpDependency = bpManifest?.dependencies?.find(dependency => dependency.uuid)
const rpDependency = rpManifest?.dependencies?.find(dependency => dependency.uuid)
if (bpDependency?.uuid !== rpManifest?.header?.uuid) {
    errors.push("BP manifest does not depend on the RP header UUID")
}
if (rpDependency?.uuid !== bpManifest?.header?.uuid) {
    errors.push("RP manifest does not depend on the BP header UUID")
}
if (JSON.stringify(bpDependency?.version) !== JSON.stringify(rpManifest?.header?.version)) {
    errors.push("BP dependency version does not match RP version")
}
if (JSON.stringify(rpDependency?.version) !== JSON.stringify(bpManifest?.header?.version)) {
    errors.push("RP dependency version does not match BP version")
}

if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
} else {
    console.log(
        `Validated ${jsonFiles.length} JSON files, ${crops.length} crops, ` +
        `${identifiers.size} definitions, and ${recipeIds.size} recipes.`
    )
}

function checkCustomReferences(value, context) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => checkCustomReferences(entry, `${context}[${index}]`))
        return
    }
    if (!value || typeof value !== "object") return

    for (const [key, entry] of Object.entries(value)) {
        if (
            typeof entry === "string" &&
            entry.startsWith("utilitycraft:") &&
            ["item", "block", "name"].includes(key) &&
            !identifiers.has(entry)
        ) {
            errors.push(`${context}.${key}: missing custom definition ${entry}`)
        }
        checkCustomReferences(entry, `${context}.${key}`)
    }
}

async function validateAtlas(path, resourceRoot) {
    const atlas = documents.get(path)
    for (const [key, definition] of Object.entries(atlas?.texture_data ?? {})) {
        const paths = Array.isArray(definition.textures)
            ? definition.textures
            : [definition.textures]
        for (const texturePath of paths) {
            if (typeof texturePath !== "string") {
                errors.push(`${relative(projectRoot, path)}:${key} has an invalid texture path`)
                continue
            }
            try {
                await access(join(resourceRoot, `${texturePath}.png`))
            } catch {
                errors.push(`${relative(projectRoot, path)}:${key} is missing ${texturePath}.png`)
            }
        }
    }
}

async function validateResourceReferences() {
    const terrainAtlas = documents.get(join(rpRoot, "textures", "terrain_texture.json"))
    const itemAtlas = documents.get(join(rpRoot, "textures", "item_texture.json"))
    const terrainKeys = new Set(Object.keys(terrainAtlas?.texture_data ?? {}))
    const itemKeys = new Set(Object.keys(itemAtlas?.texture_data ?? {}))
    const geometryIds = new Set()
    const animationIds = new Set()
    const renderControllerIds = new Set()

    for (const [path, document] of documents) {
        if (!path.startsWith(rpRoot)) continue

        for (const geometry of document["minecraft:geometry"] ?? []) {
            const identifier = geometry?.description?.identifier
            if (identifier) geometryIds.add(identifier)
        }
        for (const identifier of Object.keys(document.animations ?? {})) {
            animationIds.add(identifier)
        }
        for (const identifier of Object.keys(document.animation_controllers ?? {})) {
            animationIds.add(identifier)
        }
        for (const identifier of Object.keys(document.render_controllers ?? {})) {
            renderControllerIds.add(identifier)
        }
    }

    for (const [path, document] of documents) {
        if (path.startsWith(bpRoot)) {
            const item = document["minecraft:item"]
            const icon = item?.components?.["minecraft:icon"]
            if (typeof icon === "string" && !itemKeys.has(icon)) {
                errors.push(`${relative(projectRoot, path)}: missing item texture key ${icon}`)
            }

            const block = document["minecraft:block"]
            if (block) {
                validateBlockVisuals(block.components, path, terrainKeys, geometryIds)
                for (const permutation of block.permutations ?? []) {
                    validateBlockVisuals(permutation.components, path, terrainKeys, geometryIds)
                }
            }
            continue
        }

        if (!path.startsWith(rpRoot)) continue
        const clientEntity = document["minecraft:client_entity"]?.description
        if (!clientEntity) continue

        for (const texturePath of Object.values(clientEntity.textures ?? {})) {
            try {
                await access(join(rpRoot, `${texturePath}.png`))
            } catch {
                errors.push(`${relative(projectRoot, path)}: missing entity texture ${texturePath}.png`)
            }
        }
        for (const geometryId of Object.values(clientEntity.geometry ?? {})) {
            if (!geometryIds.has(geometryId)) {
                errors.push(`${relative(projectRoot, path)}: missing geometry ${geometryId}`)
            }
        }
        for (const animationId of Object.values(clientEntity.animations ?? {})) {
            if (!animationIds.has(animationId)) {
                errors.push(`${relative(projectRoot, path)}: missing animation ${animationId}`)
            }
        }
        for (const renderControllerId of clientEntity.render_controllers ?? []) {
            if (
                renderControllerId !== "controller.render.default" &&
                !renderControllerIds.has(renderControllerId)
            ) {
                errors.push(`${relative(projectRoot, path)}: missing render controller ${renderControllerId}`)
            }
        }
    }

    const rpBlocks = documents.get(join(rpRoot, "blocks.json")) ?? {}
    for (const [identifier, definition] of Object.entries(rpBlocks)) {
        if (identifier === "format_version") continue
        const textures = typeof definition.textures === "string"
            ? [definition.textures]
            : Object.values(definition.textures ?? {})
        for (const textureKey of textures) {
            if (!terrainKeys.has(textureKey)) {
                errors.push(`RP/blocks.json:${identifier} is missing terrain key ${textureKey}`)
            }
        }
    }
}

function validateBlockVisuals(components, path, terrainKeys, geometryIds) {
    if (!components) return

    const geometry = components["minecraft:geometry"]
    const geometryId = typeof geometry === "string" ? geometry : geometry?.identifier
    if (geometryId && !geometryIds.has(geometryId)) {
        errors.push(`${relative(projectRoot, path)}: missing geometry ${geometryId}`)
    }

    const materials = components["minecraft:material_instances"] ?? {}
    for (const material of Object.values(materials)) {
        const textureKey = material?.texture
        if (textureKey && !terrainKeys.has(textureKey)) {
            errors.push(`${relative(projectRoot, path)}: missing terrain key ${textureKey}`)
        }
    }
}

async function jsonFileCount(path) {
    return (await readdir(path, { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
        .length
}

async function collectFiles(directory) {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await collectFiles(path))
        else if (entry.isFile()) files.push(path)
    }
    return files
}
