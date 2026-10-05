# parallel-pacer

Claude Code の会話を何本も並べて回すと、`npm install` やビルドやテストが重なって PC が固まります。この Mod は、PC の CPU と空きメモリ、いま動いている会話の数を見て、**重い処理の同時実行を自動で絞り**、ステータス行に「あと何本並べられるか」を出します。

```
並列 3本(動作2) · CPU 62% · 空き 4.1GB · 余裕 あと2本可
```

Windows 用です（計測に PowerShell の `Get-CimInstance` を使います）。

## 何をするか

- **ステータス行**: 並列の会話数・CPU・空きメモリ・あと何本いけるか
- **重い処理の順番待ち**: PC が詰まっている間、他の会話で重い処理（install・build・test・typecheck・dev server など）が走っていれば、新しい重い処理を止めて「1〜2 分後にもう一度」と Claude に返す。10 分のうち 3 回止めたら、その後は通す（止めっぱなしにしない）
- **Claude へのメモ**: 詰まっている間だけ、「重い処理は 1 本ずつ」というメモをプロンプトに添える（依頼の範囲は削らせない）
- **トースト**: 詰まり気味・詰まりに変わった時に 1 回知らせる
- `/para`: 今の状態と基準を見る。`/para off` で調整を止め、`/para on` で戻す

基準は 16GB のノート PC に合わせてあります（詰まり気味 = 空き 3.5GB 未満か CPU 75% 以上・詰まり = 空き 2GB 未満か CPU 90% 以上）。[hooks/register.tsx](hooks/register.tsx) の頭の定数で変えられます。

## 入れる

```
/plugin marketplace add nakadaharuki/parallel-pacer
/plugin install parallel-pacer@parallel-pacer
```

Claude Code v2.1.287 以上。

## 中で使っている物

Mods は隔離されずに動くので、入れる前に読めるよう書いておきます。コードは [hooks/register.tsx](hooks/register.tsx) の 1 本（約 215 行）だけです。

- 通信しません（`$.http` を使わない）。環境変数・ファイルも読みません
- 外のプロセスは、30 秒に 1 回の計測（`powershell -NoProfile -Command "Get-CimInstance ..."`）だけ。会話が何本あっても、計測は PC で 1 本です（`$.store` で順番を取る）
- `$.store` に置くのは、計測値・会話の生存の印・走っている重いコマンドの種類（`npm install` など。引数は残さない）
- `Bash`・`PowerShell` の `tool.call` を見て、重いコマンドだけを止めることがあります

## 仕組みのメモ

Mod はセッションの数だけ別のプロセスで動きます。なので「PC 全体で 1 つ」の物（計測・重い処理の数）は、モジュールの変数ではなく `$.store` に置き、全部の会話が同じ値を読みます。生存の印が 60 秒途絶えた会話は、いない物として数えません。

## 関連

成分表（何に触れるか）と、版を固定した入れ方は [modscode.com/mods/parallel-pacer](https://modscode.com/mods/parallel-pacer/) にあります。

デスクトップ版の Mods で踏んだ罠は Zenn に書いています: https://zenn.dev/nakadaharuki

MIT License
