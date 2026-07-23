-- クラスタの由来・判断根拠。「ピラーが欠けている」と「設計上置かない」を区別するために要る。
ALTER TABLE "TopicCluster" ADD COLUMN "note" TEXT;
