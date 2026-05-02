import assert from "node:assert/strict";
import test from "node:test";

import { buildPlatformOutboundPayload, normalizeOutboundMessage } from "../packages/gateway/src/messages.ts";

test("outbound messages normalize rich metadata into a portable delivery contract", () => {
  const message = normalizeOutboundMessage("fallback", {
    threadTs: "1710000000.000100",
    outboundMessage: {
      text: "Deploy finished",
      markdown: true,
      attachments: [
        {
          type: "image",
          url: "https://cdn.example.com/screenshot.png",
          name: "screenshot.png",
          text: "Smoke test screenshot",
        },
      ],
    },
  });

  assert.equal(message.text, "Deploy finished");
  assert.equal(message.markdown, true);
  assert.equal(message.threadId, "1710000000.000100");
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0]?.type, "image");
});

test("platform payload builders preserve thread, reply, markdown, and media semantics", () => {
  const slack = buildPlatformOutboundPayload(
    "slack",
    normalizeOutboundMessage("Check *this*", {
      outboundMessage: {
        markdown: true,
        threadId: "1710000000.000100",
      },
    }),
  );
  assert.equal(slack.thread_ts, "1710000000.000100");
  assert.ok(Array.isArray(slack.blocks));

  const discord = buildPlatformOutboundPayload(
    "discord",
    normalizeOutboundMessage("Reply with asset", {
      outboundMessage: {
        replyToMessageId: "message-1",
        attachments: [{ type: "image", url: "https://cdn.example.com/a.png", name: "a.png" }],
      },
    }),
  );
  assert.deepEqual(discord.message_reference, { message_id: "message-1" });
  assert.ok(Array.isArray(discord.embeds));

  const whatsapp = buildPlatformOutboundPayload(
    "whatsapp",
    normalizeOutboundMessage("Screenshot", {
      outboundMessage: {
        attachments: [{ type: "image", url: "https://cdn.example.com/a.png", name: "a.png" }],
      },
    }),
  );
  assert.equal(whatsapp.type, "image");
  assert.deepEqual(whatsapp.image, {
    link: "https://cdn.example.com/a.png",
    caption: "Screenshot",
    filename: "a.png",
  });

  const teams = buildPlatformOutboundPayload(
    "teams",
    normalizeOutboundMessage("<b>Done</b>", {
      outboundMessage: { markdown: true },
    }),
  );
  assert.deepEqual(teams.body, { contentType: "html", content: "<b>Done</b>" });
});
