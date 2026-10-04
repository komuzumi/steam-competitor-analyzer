// CSV is assembled from resumable review chunks in the browser, never a partial server download.
export async function GET() {
  return Response.json({ error: "CSVはアプリのCSVボタンから出力してください。全文レビューを分割取得してから生成します。" }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
