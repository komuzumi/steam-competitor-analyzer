import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "推定ロジック解説 | Steam 競合・市場分析ダッシュボード",
  description: "Steam販売本数、所有者数、売上推定の計算ロジックと注意点を解説します。",
};

const ageRows = [
  ["発売から1年以内", "28"],
  ["発売から2年以内", "32"],
  ["発売から4年以内", "38"],
  ["発売から7年以内", "45"],
  ["発売から10年以内", "52"],
  ["発売から10年超", "60"],
];

const priceRows = [
  ["無料または $5 未満", "0.85"],
  ["$5 - $14.99", "1.00"],
  ["$15 - $29.99", "1.08"],
  ["$30 - $59.99", "1.15"],
  ["$60 以上", "1.20"],
];

const scoreRows = [
  ["95%以上", "1.12"],
  ["90% - 94%", "1.05"],
  ["80% - 89%", "1.00"],
  ["70% - 79%", "0.95"],
  ["70%未満", "0.90"],
];

const playtimeRows = [
  ["1時間未満", "0.75"],
  ["1 - 5時間", "0.90"],
  ["5 - 20時間", "1.00"],
  ["20 - 50時間", "1.08"],
  ["50時間以上", "1.15"],
];

const effectivePriceRows = [
  ["保守", "45%", "セール、地域価格、バンドル影響を強めに見る"],
  ["標準", "60%", "通常の分析で中心値として使う"],
  ["強気", "75%", "定価販売比率が高いケースを見る"],
];

function Section({
  title,
  children,
}: Readonly<{
  title: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="space-y-4 border-t border-slate-200 pt-8">
      <h2 className="text-2xl font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function Formula({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="rounded-lg bg-slate-950 px-4 py-3 font-mono text-sm text-white">{children}</div>;
}

function SimpleTable({
  headers,
  rows,
}: Readonly<{
  headers: string[];
  rows: string[][];
}>) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.join("-")} className="text-slate-700">
              {row.map((cell, index) => (
                <td key={`${cell}-${index}`} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/" className="text-sm font-medium text-blue-700 hover:text-blue-800">
          ダッシュボードへ戻る
        </Link>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Methodology</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">販売本数・売上推定ロジック</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
            このページでは、本アプリがSteam公開情報から「推定所有者」「推定Steam販売本数」「総売上」「Steam手数料控除後売上」をどう計算しているかを説明します。
            数値はSteamやGamalyticの公式値ではなく、公開レビューを中心にした独自推定です。実売上の保証値ではなく、市場規模や競合比較のための目安として扱います。
          </p>
        </div>

        <div className="mt-8 space-y-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Section title="1. 使うデータ">
            <p className="text-sm leading-7 text-slate-600">
              初回分析ではレビュー本文を取得せず、Steam公開APIなどから取れる軽量データを使います。主に使うのは、総レビュー数、Steam購入レビュー数、発売年、USD基準価格、表示通貨の定価、好評率、レビュー投稿者サンプルの平均プレイ時間です。
              現在同時接続者数は画面上の参考情報として表示しますが、DBには保存せず、売上推定にも混ぜません。
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["総レビュー数", "所有者数を推定する中心データです。レビュー数が少ないほど推定のブレは大きくなります。"],
                ["Steam購入レビュー数", "キー配布やバンドル由来を分け、Steamストア上の販売本数へ近づけるために使います。"],
                ["発売年", "古いタイトルほど、1本あたりのレビュー発生率が下がりやすい前提で倍率を上げます。"],
                ["価格", "高価格帯ほど購入者がレビューを書く比率が変わる前提で、レビュー倍率を補正します。"],
                ["好評率", "評価が高いタイトルほどレビューが集まりやすい傾向を補正します。"],
                ["平均プレイ時間", "長時間遊ばれるタイトルほどレビュー行動が変わる前提で補正します。"],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg bg-slate-50 p-4">
                  <p className="font-semibold text-slate-800">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="2. 推定所有者の出し方">
            <p className="text-sm leading-7 text-slate-600">
              まず、レビュー数から所有者数を推定します。考え方はレビュー倍率法です。総レビュー数に「このゲームでは1レビューあたり何人の所有者がいると見るか」という倍率を掛けます。
            </p>
            <Formula>推定所有者 = 総レビュー数 × 補正後レビュー倍率</Formula>
            <p className="text-sm leading-7 text-slate-600">
              補正後レビュー倍率は、発売経過年数から決めた基準倍率に、価格、好評率、平均プレイ時間の係数を掛けて作ります。最後に極端な値を避けるため、18から85の範囲に収めます。
            </p>
            <Formula>補正後レビュー倍率 = clamp(発売年倍率 × 価格補正 × 好評率補正 × プレイ時間補正, 18, 85)</Formula>
            <div className="grid gap-4 lg:grid-cols-2">
              <SimpleTable headers={["発売経過", "基準倍率"]} rows={ageRows} />
              <SimpleTable headers={["USD基準価格", "価格補正"]} rows={priceRows} />
              <SimpleTable headers={["好評率", "好評率補正"]} rows={scoreRows} />
              <SimpleTable headers={["平均プレイ時間", "プレイ時間補正"]} rows={playtimeRows} />
            </div>
          </Section>

          <Section title="3. Steam販売本数の出し方">
            <p className="text-sm leading-7 text-slate-600">
              推定所有者には、Steamストアで直接買った人だけでなく、キー配布、バンドル、外部ストア購入、無料配布などに近い所有者も混ざる可能性があります。
              そのため、Steam購入レビュー数の比率を使い、Steamストア上で売れた本数に近づけます。
            </p>
            <Formula>Steam購入レビュー比率 = Steam購入レビュー数 ÷ 総レビュー数</Formula>
            <Formula>推定Steam販売本数 = 推定所有者 × Steam購入レビュー比率</Formula>
            <p className="text-sm leading-7 text-slate-600">
              Steam購入レビュー比率は0.35から1.00の範囲に収めます。比率が極端に低いタイトルでも、すべてを外部要因とみなすと過小評価になりやすいためです。
              Steam購入レビュー数が取得できない場合は、暫定的に1.00として扱います。
            </p>
          </Section>

          <Section title="4. 売上の出し方">
            <p className="text-sm leading-7 text-slate-600">
              売上は、推定Steam販売本数に表示通貨のベースゲーム定価を掛け、さらに有効販売価格係数を掛けます。
              有効販売価格係数は、セール、地域価格、クーポン、バンドル、発売後の価格改定などをざっくり吸収するための係数です。
            </p>
            <Formula>総売上 = 推定Steam販売本数 × ベースゲーム定価 × 有効販売価格係数</Formula>
            <Formula>Steam手数料控除後売上 = 総売上 × 0.70</Formula>
            <SimpleTable headers={["ケース", "有効販売価格係数", "意味"]} rows={effectivePriceRows} />
            <p className="text-sm leading-7 text-slate-600">
              画面の「総売上」はSteam手数料控除前、「手数料控除後」はSteamのプラットフォーム手数料30%を差し引いた推定です。
              税、返金、DLC、IAP、パブリッシャー契約、地域別の実決済価格は含めていません。
            </p>
          </Section>

          <Section title="5. 保守・標準・強気のレンジ">
            <p className="text-sm leading-7 text-slate-600">
              本アプリでは単一の数字だけでなく、保守、標準、強気の3ケースを出します。標準ケースを中心値とし、所有者推定は保守で75%、強気で125%に広げます。
              売上側はさらに有効販売価格係数も、保守45%、標準60%、強気75%に分けます。
            </p>
            <Formula>保守所有者 = 標準所有者 × 0.75</Formula>
            <Formula>強気所有者 = 標準所有者 × 1.25</Formula>
            <p className="text-sm leading-7 text-slate-600">
              このレンジは統計的な信頼区間ではありません。レビュー倍率法の不確実性を、比較検討しやすい幅として表示するための実務的なレンジです。
            </p>
          </Section>

          <Section title="6. 直近7日販売本数">
            <p className="text-sm leading-7 text-slate-600">
              直近7日の販売本数は、直近7日に投稿されたSteam購入レビュー数を使って推定します。
              通常の売上推定で作った補正後レビュー倍率を掛け、同じく保守75%、標準100%、強気125%のレンジを出します。
            </p>
            <Formula>直近7日Steam販売本数 = 直近7日のSteam購入レビュー数 × 補正後レビュー倍率</Formula>
            <p className="text-sm leading-7 text-slate-600">
              人気タイトルでは取得負荷を抑えるため、直近レビュー取得は1,500件で打ち切ります。上限に達した場合は、実際にはもっと多い可能性があるため「&gt;=」付きの下限推定として表示します。
            </p>
          </Section>

          <Section title="7. 信頼度の見方">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-green-50 p-4">
                <p className="font-semibold text-green-800">High</p>
                <p className="mt-1 text-sm leading-6 text-green-900">
                  有料ゲーム、レビュー1万件以上、Steam購入レビュー比率が取得できている場合。
                </p>
              </div>
              <div className="rounded-lg bg-yellow-50 p-4">
                <p className="font-semibold text-yellow-800">Medium</p>
                <p className="mt-1 text-sm leading-6 text-yellow-900">レビュー1,000件以上だが、High条件までは満たさない場合。</p>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <p className="font-semibold text-red-800">Low</p>
                <p className="mt-1 text-sm leading-6 text-red-900">
                  レビュー1,000件未満、無料ゲーム、価格不明など、推定のブレが大きい場合。
                </p>
              </div>
            </div>
          </Section>

          <Section title="8. 使っていないデータと注意点">
            <p className="text-sm leading-7 text-slate-600">
              現時点では、同時接続者数、トップセラー順位、公開プロフィールpolling、ウィッシュリスト、DLC/IAP売上、国別の実売上データは推定に混ぜていません。
              まずはDBを使わないWebアプリとして提供するため、取得した同時接続者数や分析結果の履歴保存も行いません。
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-slate-600">
              <li>レビュー倍率法は、レビューを書かない購入者の存在を前提にした近似です。</li>
              <li>キー配布、無料配布、バンドル、外部ストア販売が多いタイトルでは、所有者とSteam販売本数の差が大きくなります。</li>
              <li>無料ゲームのベースゲーム売上は原則Low扱いです。IAPやDLC売上は今回の推定対象外です。</li>
              <li>定価と実売価格の差は有効販売価格係数で簡略化しています。地域別売上や返金は反映していません。</li>
            </ul>
          </Section>
        </div>
      </div>
    </main>
  );
}
