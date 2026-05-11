"use client";

interface ProgressItem {
  appId: string;
  appName?: string;
  phase: string;
  detail?: string;
}

interface Props {
  progress: Record<string, ProgressItem>;
}

export default function LoadingSpinner({ progress }: Props) {
  const items = Object.values(progress);

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      <p className="mt-4 text-sm text-gray-600">分析中...</p>

      {items.length > 0 && (
        <div className="mt-4 w-full max-w-lg space-y-2">
          {items.map((item) => (
            <div key={item.appId} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-800">
                  {item.appName || `AppID: ${item.appId}`}
                </span>
                <span className="text-right text-xs font-medium text-blue-600">{item.phase}</span>
              </div>
              {item.detail && <p className="mt-1 text-xs text-gray-500">{item.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
