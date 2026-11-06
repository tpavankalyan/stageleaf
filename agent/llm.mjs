// Chooses how the agent reaches Claude. Order for STAGELEAF_LLM=auto (the default):
//   1. Amazon Bedrock, when AWS credentials or a region are configured. Uses the
//      Bedrock InvokeModel endpoint, which needs only bedrock:InvokeModel.
//      STAGELEAF_LLM=bedrock-mantle uses the newer Mantle endpoint instead.
//   2. The Claude API, when ANTHROPIC_API_KEY is set.
//   3. No model: the deterministic command parser in rules.mjs.
// Force a choice with STAGELEAF_LLM=bedrock | bedrock-mantle | anthropic | rules.
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";

const hasAws = (env) =>
  !!(env.AWS_REGION || env.AWS_DEFAULT_REGION || env.AWS_PROFILE || env.AWS_ACCESS_KEY_ID);

export function resolveLLM(env = process.env, log = console) {
  const want = (env.STAGELEAF_LLM || "auto").toLowerCase();
  const model = env.STAGELEAF_MODEL || "claude-opus-5-5";
  const effort = env.STAGELEAF_EFFORT || "medium";
  if (want === "rules") return null;

  if (want === "bedrock" || want === "bedrock-mantle" || (want === "auto" && hasAws(env))) {
    const awsRegion = env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1";
    if (want === "bedrock-mantle") {
      const client = new AnthropicBedrockMantle({ awsRegion });
      const id = env.STAGELEAF_BEDROCK_MODEL || `anthropic.${model}`;
      return {
        label: `${model} on Amazon Bedrock (Mantle, ${awsRegion})`,
        model,
        effort,
        create: (params) =>
          client.messages.create({ ...params, model: id, output_config: { effort } }),
      };
    }
    const client = new AnthropicBedrock({ awsRegion });
    // A cross-region inference profile; override with a regional profile if needed.
    const id = env.STAGELEAF_BEDROCK_MODEL || `global.anthropic.${model}`;
    return {
      label: `${model} on Amazon Bedrock (${awsRegion})`,
      model,
      effort,
      create: (params) =>
        client.messages.create({ ...params, model: id, output_config: { effort } }),
    };
  }

  if (want === "anthropic" || (want === "auto" && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN))) {
    const client = new Anthropic();
    let fallbacks = env.STAGELEAF_FALLBACKS !== "off";
    return {
      label: `${model} via the Claude API`,
      model,
      effort,
      async create(params) {
        const request = { ...params, model, output_config: { effort } };
        if (fallbacks) {
          try {
            // Server-side refusal fallbacks route a declined request to another model.
            return await client.beta.messages.create({
              ...request,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            });
          } catch (error) {
            if (!(error instanceof Anthropic.BadRequestError)) throw error;
            log.warn("Server-side fallbacks were rejected; continuing without them.");
            fallbacks = false;
          }
        }
        return client.messages.create(request);
      },
    };
  }
  return null;
}
