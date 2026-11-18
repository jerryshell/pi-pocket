/**
 * Whether Command Code requests ask for zero data retention.
 *
 * The Provider API documents `x-cmd-zdr: 1` as the opt-in for zero data retention and no prompt training; Pi Pocket
 * sends it on every request by default. `CMD_ZDR=0` (or its `COMMANDCODE_ZDR` alias) turns it off, and a model with no
 * ZDR-capable upstream then no longer fails with `422 cmd_zdr_no_providers`.
 */
export function zdrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CMD_ZDR !== "0" && env.COMMANDCODE_ZDR !== "0";
}
