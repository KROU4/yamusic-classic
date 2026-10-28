export function Loading() {
  return (
    <div class="state">
      <span class="spinner" />
    </div>
  );
}

export function ErrorState({ error, retry }) {
  return (
    <div class="state">
      <p>{error?.status === 401 ? "Нет сессии Яндекс Музыки." : `Не удалось загрузить: ${error?.message || "ошибка"}`}</p>
      {retry && (
        <button class="btn ghost" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function PageHead({ cover, round, kicker, title, children, actions }) {
  return (
    <div class="page-head">
      {cover !== undefined && <div class={`page-cover ${round ? "round" : ""}`}>{cover ? <img src={cover} alt="" /> : <div class="ph" />}</div>}
      <div class="page-head-info">
        {kicker && <div class="kicker">{kicker}</div>}
        <h1>{title}</h1>
        {children}
        {actions && <div class="page-actions">{actions}</div>}
      </div>
    </div>
  );
}
