/**
 * Loop: Pi keeps working in a session on its own, answer after answer, until a person stops it. /loop-on [goal] starts
 * the loop; /loop-off ends it, and so does Stop. A run that ends without going on ends the loop too, such as one that
 * failed or one past a spend limit, because the next round comes only from Pi's own answer. While this is off, a loop
 * waits in its session and does nothing.
 */
import {
    defineDoc,
    defineExtension,
    defineTask,
    GenerationTask,
    hook,
    LiveDoc,
    section,
} from "@earendil-works/pi-durable";
import { PlanDoc } from "../docs.ts";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { ExtensionWeb, PocketHost, WebRequest } from "../host.ts";
import { requestFor } from "../requests.ts";

/** The extension that runs a session's loop; while it is off, a loop waits. */
const LOOP_EXTENSION = "pocket-loop";
/** How each round's message to Pi starts, so that Pi knows what it is. */
const PREFIX = "[loop] ";
/** The aim of a loop that was started without one. */
const DEFAULT_GOAL =
    "Keep improving this project: do the most valuable unfinished work you can see, and verify it.";
const MAX_GOAL = 2_000;
/** How often a running loop looks whether Pi still works: a stopped run ends the loop within two looks. */
const POLL_MS = 5_000;
/** How often a loop that waits for the answer to a plan looks: it waits long, and nobody works there. */
const PLAN_POLL_MS = 60_000;

/** A loop in one session: its aim, who started it, and when. Two loops are the same one by `at`. */
type LoopOn = { goal: string; by: string; at: number };

/** A session's loop. Stored data: never rename the kind. */
export const LoopDoc = defineDoc<{ on?: LoopOn }>({
    kind: "pocket.loop",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    checkpointWhen: () => false,
    initial: () => ({}),
});

type LoopCheckpoint =
    | { phase: "kick" }
    | { phase: "watch"; idle: number; delay: number }
    | { phase: "check"; idle: number };

const finished = {
    status: "terminal",
    outcome: { status: "completed", result: null },
} as const;

/** What Pi reads each round: the next step, and that only a person ends the loop. */
function round(goal: string): string {
    return (
        `${PREFIX}Take the next step now, by yourself: the most valuable unfinished work toward “${goal}”. ` +
        "Change something real, such as a file, a command, or a check. Then verify your work, say in one line what " +
        "you did and what you found, and go on with the next step. Do not ask for permission, do not ask whether to " +
        "go on, and do not end with a question. When the goal is done, find the next most valuable improvement. " +
        "Only a person ends this loop."
    );
}

export default function createLoop(host: PocketHost, web: ExtensionWeb) {
    /**
     * A loop's supervisor: it starts the first round, then ends the loop as soon as Pi's run ends without going on.
     * It holds no invocation between its looks, so it survives a restart, and an idle session costs one read.
     */
    const LoopWatch = defineTask<{ at: number }, LoopCheckpoint, null>({
        name: "pocket.loop",
        version: 1,
        initial: () => ({ phase: "kick" }),
        phases: {
            kick: async (task, runtime, context) => {
                const conversationId = runtime.conversationId;
                const on = (await runtime.snapshot(LoopDoc, conversationId, context))?.on;
                const live = await runtime.snapshot(LiveDoc, conversationId, context);
                const conversation = await runtime.conversation(conversationId, context);

                // Pi works already: its own answer goes on with the loop, so this round is not sent now.
                if (
                    conversation !== undefined &&
                    on?.at === task.input.at &&
                    live?.run === undefined
                ) {
                    await conversation.submit(
                        {
                            type: "input",
                            content: round(on.goal),
                            requestId: requestFor(on.by, `loop-${String(on.at)}`),
                        },
                        context,
                    );
                }

                return runtime.commit(
                    () => ({
                        status: "running",
                        checkpoint: { phase: "watch", idle: 0, delay: POLL_MS },
                    }),
                    context,
                );
            },
            watch: (task, runtime, context) =>
                runtime.sleepUntil(
                    runtime.now() + task.state.checkpoint.delay,
                    { phase: "check", idle: task.state.checkpoint.idle },
                    context,
                ),
            check: async (task, runtime, context) => {
                const conversationId = runtime.conversationId;
                const on = (await runtime.snapshot(LoopDoc, conversationId, context))?.on;

                // Another loop, or none: this watcher is done, and it must not end a loop that is not its own.
                if (on?.at !== task.input.at) {
                    return runtime.commit(() => finished, context);
                }

                const live = await runtime.snapshot(LiveDoc, conversationId, context);

                if (live?.run !== undefined) {
                    return runtime.commit(
                        () => ({
                            status: "running",
                            checkpoint: { phase: "watch", idle: 0, delay: POLL_MS },
                        }),
                        context,
                    );
                }

                // Plan mode: Pi proposes, and the loop waits for the answer to the plan, without looking often.
                if ((await runtime.snapshot(PlanDoc, conversationId, context))?.on === true) {
                    return runtime.commit(
                        () => ({
                            status: "running",
                            checkpoint: { phase: "watch", idle: 0, delay: PLAN_POLL_MS },
                        }),
                        context,
                    );
                }

                // Two idle looks in a row: the run that should have gone on ended instead, so the loop ends.
                if (task.state.checkpoint.idle === 0) {
                    return runtime.commit(
                        () => ({
                            status: "running",
                            checkpoint: { phase: "watch", idle: 1, delay: POLL_MS },
                        }),
                        context,
                    );
                }

                await runtime.commit(async (tx) => {
                    const doc = await tx.doc(LoopDoc, conversationId);

                    delete doc.on;

                    return finished;
                }, context);

                host.notice(
                    "info",
                    "The loop stopped: Pi's run ended. Start it again with /loop-on.",
                    conversationId,
                );
                web.send("loop", { conversation: Number(conversationId), on: null });
            },
        },
        abort: (_task, runtime, context) =>
            runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
    });

    web.command("loop-on", {
        description: "Pi keeps working on its own, step after step, until someone stops it",
        args: "[goal]",
        scope: "conversation",
        handler: async (args, ctx) => {
            const goal = args.trim().slice(0, MAX_GOAL) || DEFAULT_GOAL;
            const before = (await ctx.snapshot(LoopDoc, ctx.conversationId, ctx.context))?.on;
            // A new goal on the loop that is there keeps it, and the loop it belongs to.
            const at = before?.at ?? Date.now();

            await ctx.commit(async (tx) => {
                const doc = await tx.doc(LoopDoc, ctx.conversationId);

                doc.on = { goal, by: ctx.user.id, at };

                // One watcher for one loop: a new goal on the same loop keeps the watcher that is there.
                if (before === undefined) {
                    await tx.createTask(
                        LoopWatch,
                        { at },
                        {
                            ownership: { kind: "conversation" },
                            conversationId: ctx.conversationId,
                            background: true,
                        },
                    );
                }
            });

            web.send("loop", {
                conversation: Number(ctx.conversationId),
                on: { goal, by: ctx.user.id, at },
            });

            return {
                type: "card",
                output:
                    before === undefined
                        ? `Loop on: ${goal}\n\nPi takes the next step after each of its answers, until someone presses Stop or runs /loop-off.`
                        : `Loop goal changed: ${goal}\n\nThe loop goes on with this aim from Pi's next answer.`,
            };
        },
    });

    web.command("loop-off", {
        description: "Pi ends after this answer: the loop stops",
        scope: "conversation",
        handler: async (_args, ctx) => {
            const on = (await ctx.snapshot(LoopDoc, ctx.conversationId, ctx.context))?.on;

            if (on === undefined) {
                return { type: "toast", level: "info", message: "No loop is on in this session." };
            }

            await ctx.commit(async (tx) => {
                const doc = await tx.doc(LoopDoc, ctx.conversationId);

                delete doc.on;
            });

            web.send("loop", { conversation: Number(ctx.conversationId), on: null });

            return {
                type: "toast",
                level: "info",
                message: "The loop is off: Pi ends after this answer. Press Stop to end it now.",
            };
        },
    });

    /** The status line's loop, its sheet, and their routes: the app's own page, for people who see the session. */
    web.client("loop", { access: "view" });

    /** The session a request names, when the person who asks may see it. */
    function sessionOf(request: WebRequest, asked: unknown): ConversationId {
        const id = Number(asked);
        const seen = request.sessions().some((session) => session.id === id);

        if (!Number.isSafeInteger(id) || !seen) {
            throw web.error(404, "No such session.");
        }

        return id as ConversationId;
    }

    web.route(
        "GET",
        "loop",
        async (request) => {
            const id = sessionOf(request, request.query.get("conversation"));

            return { on: (await request.snapshot(LoopDoc, id, request.context))?.on ?? null };
        },
        { access: "view" },
    );

    // Stop the loop from its sheet, as `/loop-off` does. The people who may steer everywhere ask; anyone who steers
    // one session runs the command there.
    web.route(
        "POST",
        "loop/stop",
        async (request) => {
            const id = sessionOf(request, request.body.conversation);

            if (request.body.off !== true) {
                throw web.error(400, "Only stopping the loop is asked for here.");
            }

            await request.commit(async (tx) => {
                const doc = await tx.doc(LoopDoc, id);

                delete doc.on;
            });

            web.send("loop", { conversation: Number(id), on: null });

            return { on: null };
        },
        { access: "steer" },
    );

    return defineExtension({
        name: LOOP_EXTENSION,
        sections: [
            section("loop", async (input, context) => {
                const on = (await input.read.snapshot(LoopDoc, input.conversationId, context))?.on;

                if (on === undefined) {
                    return undefined;
                }

                return `A loop is on in this session, with the aim “${on.goal}”. After each of your answers you get a message that starts with “${PREFIX.trim()}” and tells you to take the next step. Work that way without asking: only a person ends the loop, by pressing Stop or by running /loop-off.`;
            }),
        ],
        hooks: [
            hook(GenerationTask, {
                onYield: async (_answer, api, context) => {
                    const on = (await api.snapshot(LoopDoc, api.conversationId, context))?.on;

                    if (on === undefined) {
                        return undefined;
                    }

                    // In plan mode Pi proposes and changes nothing: the loop waits until someone answers the plan.
                    if ((await api.snapshot(PlanDoc, api.conversationId, context))?.on === true) {
                        return undefined;
                    }

                    // Past a spend limit Pi takes no new work: the loop ends here, and says why.
                    const why = host.heldBack(api.conversationId);

                    if (why !== undefined) {
                        host.notice("warning", `The loop stopped: ${why}.`, api.conversationId);

                        return undefined;
                    }

                    return { continue: round(on.goal) };
                },
            }),
        ],
        tasks: [LoopWatch],
    });
}
