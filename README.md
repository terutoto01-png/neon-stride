# NEON STRIDE

WebGPU (`three/webgpu` + TSL Node Shaders + HDR Bloom) を活用した、iPad・スマホ・PC 向けの 3 レーン・パルクールアクションゲームです。

## プレイする（GitHub Pages）
https://terutoto01-png.github.io/neon-stride/

## 特徴
- **WebGPU + TSL カスタムシェーダー & HDR Bloom**（未対応端末は WebGL2 自動フォールバック）
- **立体 3D スカイウェイ**：カーブ・高低差・バンク（傾斜）のあるダイナミックコース
- **パルクールアクション**：ウォールラン＆壁蹴り、グラインドレール、ランチャー台フリップ、パワースライド、空中急降下、パーフェクトヴォルト、オーバードライブ無敵突進
- **シネマティック・カメラワーク**：ウォールラン時のダッチロール、スライド低空視点、ブースト FOV 拡張、着地インパクト
- **iPad / スマホ最適化**：ゼロ遅延スワイプ操作・2本指オーバードライブ・スプリットタッチパッド対応

## 起動方法

```bash
npm install
npm run dev -- --host
```

## テスト & ビルド

```bash
npm test
npm run build
```
