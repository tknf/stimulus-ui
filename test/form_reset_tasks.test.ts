import { expect, test } from "vite-plus/test";
import { createFormResetTasks } from "../src/internal/form_reset_tasks";

test("[form-reset-tasks-cancel] Does not run canceled tasks and runs only new tasks scheduled after reconnection", async () => {
	const tasks = createFormResetTasks();
	const results: string[] = [];
	tasks.schedule(() => results.push("古い予約1"));
	tasks.schedule(() => results.push("古い予約2"));
	tasks.cancel();
	tasks.schedule(() => results.push("新しい予約1"));
	tasks.schedule(() => results.push("新しい予約2"));
	await new Promise((resolve) => setTimeout(resolve, 30));
	expect(results).toEqual(["新しい予約1", "新しい予約2"]);
	tasks.cancel();
});
