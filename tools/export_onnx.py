#!/usr/bin/env python3
"""把 PyTorch 模型导出为 ONNX，供 Synapse Studio 画出真实计算图。

为什么走 ONNX：源码 AST 分析只能"猜"结构，而 ONNX 是编译器导出的确定事实——
每个算子、每条边、每个张量形状都是写死的。这正是"又准"的根。

用法：

    # 1) 从模型定义文件导出
    python tools/export_onnx.py --model=models/resnet.py --class-name=ResNet18 \\
        --input-shape=1,3,224,224 --out=artifacts/onnx/my-model.onnx

    # 2) 带权重
    python tools/export_onnx.py --model=models/unet.py --class-name=UNet \\
        --checkpoint=weights/unet.pth --input-shape=1,3,256,256 --out=artifacts/onnx/unet.onnx

导出后：

    node scripts/draw-onnx.mjs --input=artifacts/onnx/my-model.onnx

导出策略（自动降级，并在结尾打印实际使用的那一条）：
    1. torch.onnx.export(..., dynamo=True)  —— PyTorch 2.6+ 的 torch.export 路径，
       能保留控制流，是最"准"的一条；
    2. torch.onnx.export(..., dynamo=False) —— 经典 TorchScript trace，
       会丢失依赖数据的控制流，但兼容性最好。
"""

from __future__ import annotations

import argparse
import importlib.util
import inspect
import os
import sys
from pathlib import Path


def parse_shape(value: str):
    try:
        dims = [int(part) for part in value.replace(" ", "").split(",") if part]
    except ValueError:
        raise SystemExit(f"--input-shape 必须是逗号分隔的整数，收到: {value!r}")
    if not dims:
        raise SystemExit("--input-shape 不能为空")
    return dims


def load_model(args):
    import torch

    model_path = Path(args.model).resolve()
    if not model_path.exists():
        raise SystemExit(f"找不到模型定义文件: {model_path}")

    spec = importlib.util.spec_from_file_location(model_path.stem, model_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"无法导入模型定义文件: {model_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[model_path.stem] = module
    spec.loader.exec_module(module)

    if not args.class_name:
        raise SystemExit("需要 --class-name 指定模型类名（例如 ResNet18）")
    if not hasattr(module, args.class_name):
        available = [name for name in dir(module) if isinstance(getattr(module, name), type)]
        raise SystemExit(
            f"{model_path.name} 中没有类 {args.class_name!r}。可用的类: {', '.join(sorted(available)) or '（无）'}"
        )

    model = getattr(module, args.class_name)()

    if args.checkpoint:
        checkpoint_path = Path(args.checkpoint).resolve()
        if not checkpoint_path.exists():
            raise SystemExit(f"找不到权重文件: {checkpoint_path}")
        state = torch.load(str(checkpoint_path), map_location="cpu", weights_only=False)
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        missing, unexpected = model.load_state_dict(state, strict=not args.allow_partial_checkpoint)
        if missing and not args.allow_partial_checkpoint:
            raise SystemExit(f"权重缺少 {len(missing)} 个键，例如 {missing[:3]}；如确认可忽略请加 --allow-partial-checkpoint")
        if unexpected:
            print(f"[warn] 权重中有 {len(unexpected)} 个未使用的键，例如 {unexpected[:3]}", file=sys.stderr)

    model.eval()
    return model


def export(model, dummy, out_path: Path, opset: int, dynamic_batch: bool):
    import torch

    input_names = ["input"]
    output_names = ["output"]
    dynamic_axes = None
    if dynamic_batch:
        dynamic_axes = {"input": {0: "batch"}, "output": {0: "batch"}}

    export_params = inspect.signature(torch.onnx.export).parameters
    supports_dynamo = "dynamo" in export_params

    attempts = []
    if supports_dynamo:
        attempts.append(("torch.onnx.export(dynamo=True) —— torch.export 路径", {"dynamo": True}))
    attempts.append(
        (
            "torch.onnx.export(dynamo=False) —— TorchScript trace 路径" if supports_dynamo else "torch.onnx.export —— TorchScript trace 路径",
            {"dynamo": False} if supports_dynamo else {},
        )
    )

    failures = []
    for label, kwargs in attempts:
        try:
            torch.onnx.export(
                model,
                dummy,
                str(out_path),
                opset_version=opset,
                input_names=input_names,
                output_names=output_names,
                dynamic_axes=dynamic_axes,
                do_constant_folding=True,
                export_params=True,
                **kwargs,
            )
            return label
        except Exception as exc:  # noqa: BLE001 - 逐条降级，最后统一报错
            failures.append((label, exc))
            print(f"[warn] {label} 失败: {type(exc).__name__}: {exc}", file=sys.stderr)

    detail = "\n".join(f"  - {label}: {type(exc).__name__}: {exc}" for label, exc in failures)
    raise SystemExit(f"所有导出方式都失败了：\n{detail}")


def summarize(out_path: Path):
    """尽量给出算子数与张量数，让用户导出后立刻知道图是否完整。"""
    try:
        import onnx  # type: ignore
    except ImportError:
        return None
    try:
        model = onnx.load(str(out_path))
        return {
            "nodes": len(model.graph.node),
            "initializers": len(model.graph.initializer),
            "inputs": [f"{value.name}{list(value.type.tensor_type.shape.dim and [d.dim_value or d.dim_param for d in value.type.tensor_type.shape.dim] or [])}" for value in model.graph.input],
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] 无法用 onnx 包读取摘要: {exc}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="把 PyTorch 模型导出为 ONNX（供 Synapse Studio 绘图）")
    parser.add_argument("--model", required=True, help="模型定义 .py 文件路径")
    parser.add_argument("--class-name", required=True, help="模型类名，例如 ResNet18")
    parser.add_argument("--checkpoint", help="可选：权重文件（.pt/.pth），支持 state_dict 或含 state_dict 的字典")
    parser.add_argument("--input-shape", default="1,3,224,224", help="示例输入形状，逗号分隔，默认 1,3,224,224")
    parser.add_argument("--out", required=True, help="输出 .onnx 路径")
    parser.add_argument("--opset", type=int, default=17, help="ONNX opset 版本，默认 17")
    parser.add_argument("--dynamic-batch", action="store_true", help="把 batch 维导出为动态维度")
    parser.add_argument("--allow-partial-checkpoint", action="store_true", help="允许权重只覆盖部分参数")
    args = parser.parse_args()

    try:
        import torch  # noqa: F401
    except ImportError:
        raise SystemExit(
            "当前 Python 环境没有安装 PyTorch。请先安装：\n"
            "    pip install torch\n"
            "如果只想验证绘图链路、暂时不想装 torch，可以直接用合成样例：\n"
            "    node tools/make-sample-onnx.mjs --model=all"
        )

    import torch

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    model = load_model(args)
    shape = parse_shape(args.input_shape)
    dummy = torch.zeros(*shape, dtype=torch.float32)

    strategy = export(model, dummy, out_path, args.opset, args.dynamic_batch)

    if not out_path.exists():
        raise SystemExit(f"导出结束但没有生成文件: {out_path}")

    summary = summarize(out_path)
    print(f"导出成功: {out_path}")
    print(f"  导出方式: {strategy}")
    print(f"  文件大小: {out_path.stat().st_size} bytes")
    if summary:
        print(f"  ONNX 节点数: {summary['nodes']}（即 Synapse Studio 将画出的算子数）")
        print(f"  图输入: {', '.join(summary['inputs']) or '（无）'}")
    print("")
    print("下一步 —— 直接出图：")
    print(f"  node scripts/draw-onnx.mjs --input={os.path.relpath(out_path, Path.cwd())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
