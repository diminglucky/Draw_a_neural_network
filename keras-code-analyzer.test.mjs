import assert from "node:assert/strict";
import test from "node:test";
import { analyzeKerasSource } from "./keras-code-analyzer.mjs";

test("Keras AST analyzer extracts Sequential layers", async () => {
  const result = await analyzeKerasSource({
    source: `
import tensorflow as tf
model = tf.keras.Sequential([
    tf.keras.layers.Conv2D(32, 3, activation="relu"),
    tf.keras.layers.MaxPooling2D(2),
    tf.keras.layers.Flatten(),
    tf.keras.layers.Dense(10),
])
`,
    framework: "keras",
  });
  assert.equal(result.status, "grounded");
  assert.deepEqual(result.ir.nodes.map((node) => node.family), [
    "input",
    "conv",
    "pool",
    "flatten",
    "dense",
    "output",
  ]);
});

test("Keras AST analyzer extracts a basic Functional graph", async () => {
  const result = await analyzeKerasSource({
    source: `
import tensorflow as tf
inputs = tf.keras.Input(shape=(32, 32, 3))
x = tf.keras.layers.Conv2D(16, 3, activation="relu")(inputs)
x = tf.keras.layers.MaxPooling2D(2)(x)
outputs = tf.keras.layers.Dense(10)(x)
model = tf.keras.Model(inputs=inputs, outputs=outputs)
`,
    framework: "keras",
  });
  assert.equal(result.status, "grounded");
  assert.ok(result.ir.nodes.some((node) => node.family === "conv"));
  assert.ok(result.ir.nodes.some((node) => node.family === "pool"));
  assert.ok(result.ir.nodes.some((node) => node.family === "dense"));
  assert.ok(result.ir.edges.some((edge) => edge.type === "output"));
});
