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
      <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      <p className="mt-4 text-gray-600 text-sm">分析中...</p>

      {items.length > 0 && (
        <div className="mt-4 w-full max-w-lg space-y-2">
          {items.map((item) => (
            <div
              key={item.appId}
              className="bg-white rounded-lg border border-gray-200 px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">
                  {item.appName || `AppID: ${item.appId}`}
                </span>
                <span className="text-xs text-blue-600 font-medium">{item.phase}</span>
              </div>
              {item.detail && (
                <p className="text-xs text-gray-500 mt-1">{item.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
