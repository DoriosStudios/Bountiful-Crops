import { BlockPermutation } from "@minecraft/server"

export const RETROCOMPATIBILITY_COMPONENT = {
    onTick({ block }, { params } = {}) {
        const targetTypeId = params?.target
        if (typeof targetTypeId !== "string") return

        try {
            const states = block.permutation.getAllStates()
            let targetPermutation = BlockPermutation.resolve(targetTypeId)

            for (const [state, value] of Object.entries(states)) {
                try {
                    targetPermutation = targetPermutation.withState(state, value)
                } catch {}
            }

            block.setPermutation(targetPermutation)
        } catch {}
    }
}
