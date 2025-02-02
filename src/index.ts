import { Hono, type Context } from "hono";
import { todos } from "../data.json";
import { Ratelimit } from "@upstash/ratelimit";
import type { BlankInput } from "hono/types";
import { Redis } from "@upstash/redis/cloudflare";

type Env = {
	Variables: {
		ratelimit: Ratelimit;
	};
	Bindings: {
		UPSTASH_REDIS_REST_URL: string;
		UPSTASH_REDIS_REST_TOKEN: string;
	};
};

const cache = new Map();

class RedidRateLimiter {
	private static instance: Ratelimit;

	private constructor() {}

	static getInstance(c: Context<Env, "/todos/:id", BlankInput>) {
		if (!this.instance) {
			const redisClient = new Redis({
				token: c.env.UPSTASH_REDIS_REST_TOKEN,
				url: c.env.UPSTASH_REDIS_REST_URL,
			});

			const ratelimit = new Ratelimit({
				redis: redisClient,
				limiter: Ratelimit.slidingWindow(10, "10 s"), // 10秒あたり10回のリクエストを許可
				ephemeralCache: cache, // グローバルキャッシュを使用時のみ有効
			});

			this.instance = ratelimit;
			return this.instance;
		}

		return this.instance;
	}
}

const app = new Hono<Env>();

app.use(async (c, next) => {
	const ratelimit = RedidRateLimiter.getInstance(c);
	c.set("ratelimit", ratelimit);
	await next();
});

app.get("/todos/:id", async (c) => {
	const ratelimit = c.get("ratelimit");
	const ip = c.req.raw.headers.get("CF-Connecting-IP");

	const { success } = await ratelimit.limit(ip ?? "anonymous");

	if (!success) {
		return c.json({ message: "Rate limit exceeded" }, 429);
	}

	const todoId = c.req.param("id");
	const todoIndex = Number(todoId) - 1;
	const todo = todos[todoIndex] || {};

	return c.json(todo);
});

export default app;
