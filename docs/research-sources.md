# Исследование: Яндекс Музыка, старый дизайн, жалобы, Моя волна, цензура, open-source клиенты

Дата: 2026-10-28. Метод: веб-поиск и чтение страниц (около 20 запросов). Что не удалось подтвердить источниками, помечено «не проверено».

## 1. Старый дизайн (до редизайна) и «колесо»

### Хронология
- Старый дизайн (светлая тема, красная нота в логотипе) почти 9 лет глобально не менялся. Большой редизайн: 1 декабря 2023 (новый логотип, чёрный фон по умолчанию, главная разделена на вкладки «Для вас» и «Тренды»). https://trashbox.ru/link/2023-12-01-muzyka-obnovila-logotip-glavnuyu-stranicu-i-vizualnyj-stil
- Десктоп/веб: новая главная с крупным блоком «Моя волна» сверху шла в бете, автор Хабра заметил её 6 ноября 2024; старый интерфейс тогда ещё можно было вернуть. https://habr.com/en/articles/856716 , https://workspace.ru/blog/mini-ux-patrul-redizayn-yandeks-muzyki-kotoryy-ne-smog/
- Отдельное приложение для Mac с обновлённым дизайном: https://ichip.ru/novosti/yandeks-muzyka-poluchila-obnovlyonnyj-dizajn-i-otdelnoe-prilozhenie-dlya-mac-851502 ; обзор: https://rozetked.me/reviews/31538-obzor-obnovlennogo-prilozheniya-yandeks-muzyka-krasivo
- Уточнение: «волна» поверх обложки с генеративной анимацией, подстраивающейся под ритм и лайки: https://snob.ru/news/iandeks-muzyka-obnovila-dizain-moei-volny/

### Что такое «колесо»
- «Колесо» (в статьях: «круглый скролл») — крупный блок «Моя волна» вверху главной с анимацией и круговой прокруткой настроек (настроение, занятие, жанр, характер). Кнопка «Настроить волну» спрятана в нём; пользователи называют это главной проблемой редизайна. Источники: https://t-j.ru/unwave-my-music/ , https://workspace.ru/blog/mini-ux-patrul-redizayn-yandeks-muzyki-kotoryy-ne-smog/

### Старая главная (что подтверждено)
- Шапка: логотип, разделы «Главное», «Подкасты и книги», «Детям», «Коллекция», поиск, установка приложения, аккаунт.
- Блоки: «Моя волна» (небольшой), плейлисты (Плейлист дня, Премьера, Дежавю, Тайник), недавно прослушанное, клипы, новые релизы, чарт, подборки. В новой версии общий контент (чарты, подборки) увели во вкладку «Тренды»; раньше он шёл сразу под персональными. Источники: workspace.ru (выше), rozetked (выше).
- Карточка трека: 3 действия (лайк, play, поделиться); в новой — до 5+ кнопок при наведении. Клик по карточке открывал альбом справа; одинарный клик по премьере/треку запускал воспроизведение (теперь двойной). Источник: habr 856716.
- Плеер: снизу, простой. Страница главной при возврате не сбрасывала прокрутку (сейчас сбрасывает).
- Новый «Тренды» содержит жанры, настроения, занятия, эпохи, альбомы месяца, чарт: https://trashbox.ru/link/2023-12-01-muzyka-obnovila-logotip-glavnuyu-stranicu-i-vizualnyj-stil . Сетка «Настроения и жанры» (плитки) относится к «старому» разделу «Главное»; точную раскладку старой сетки в найденных статьях не описали.

### Не проверено (нужны скриншоты Wayback / archive.org music.yandex.ru за 2021-2023)
- Точный порядок блоков старой главной, состав плитки «Настроения и жанры».
- Цвета и шрифт: жёлтый акцент (#ffdb4d / #fc3) и YS Text взяты из задания пользователя и общих знаний, источником не подтверждены. Рекомендация: снять токены напрямую с web.archive.org снимков и CSS старого music.yandex.ru.

## 2. Жалобы пользователей

Источники: https://dtf.ru/5124533-post-nenavisti-k-yandeks-muzyke , https://t-j.ru/unwave-my-music/ , https://habr.com/en/articles/856716 , https://habr.com/en/news/894440/comments , https://www.iphones.ru/iNotes/user-posts/nenavizhu-neyromuzyku , https://uniseller.io/blog/neyromusika-v-yandex-music-problema-i-reshenie

- Просьба №1: вернуть старый дизайн или дать выбор. Многие пишут, что раньше рекомендации были точнее.
- Колесо: ненужная прокрутка, настройки спрятаны; автовоспроизведение при запуске; Play запускает «Мне нравится» вместо волны; главная скроллится в начало.
- Рекомендации: волна повторяет «Мне нравится» и дизлайкнутые треки; «Встряхнуть мою волну» почти ничего не меняет; качество падает после 5-10 треков; много неразмеченной ИИ-музыки (Suno), фильтра нет; дизлайк одного ИИ-исполнителя заменяется десятью новыми.
- Баги: треки играют по несколько раз при быстром листании, не подгружаются картинки, дёрганый скролл, долгий старт трека, Bluetooth-автовоспроизведение. Сбои сервиса (март 2025): https://www.iphones.ru/iNotes/yandeks-muzyka-slomalas-vtoroy-raz-za-nedelyu-nichego-ne-zagruzhaetsya
- Интерфейс: перегруженные карточки, убрали страницы лейблов, тормоза при прокрутке (комментарии Хабра), блок концертов выше музыки, размытый текст песни, мелкое название трека.
- Замена треков: удалённые из плейлистов треки подменяются каверами/лайвами (dtf).
- Электрон/тяжесть: прямых отзывов про память не нашёл (клиент на Electron подтверждён косвенно). Не проверено, нужны данные 4pda/Microsoft Store.
- Пожелания: выбор дизайна, фильтр ИИ-музыки, нормальные дизлайки, детерминированный Play, скачивание/кэш на другой диск, мини-плеер, скробблинг.

## 3. Борьба с повторами «Моей волны»

- Встроенные настройки: язык (в 2025 добавлено 12 языков: французский, немецкий, японский, казахский и др.; раньше русский/не русский/без слов), «Без слов», настроение, характер (Любимое / Незнакомое / Популярное), занятие. https://habr.com/ru/news/963670 , https://rozetked.me/news/42594-moya-volna-v-yandeks-muzyke-teper-podbiraet-muzyku-na-dvenadcati-raznyh-yazykah , https://www.iphones.ru/iNotes/v-yandeks-muzyke-poyavilis-rekomendacii-trekov-bez-slov-03-16-2023
- «Моя волна по треку/исполнителю/альбому» как способ сбросить подборку. https://t-j.ru/lt-my-vibe-yandex-music/
- Народные обходы: массовые дизлайки, чистка «Мне нравится», слушать «Мне нравится» вместо волны. Надёжность низкая по самим жалобам.
- Неофициальный API (библиотека yandex-music-api, поле `RotorSettings`): `language` in {`not-russian`, `russian`, `any`}; `diversity` in {`favorite`, `popular`, `discover`, `default`}; `mood_energy` in {`fun`, `active`, `calm`, `sad`, `all`}; устаревшие `mood`/`energy` (int) из settings1. https://ym.marshal.dev/en/main/yandex_music.rotor.rotor_settings.html (зеркало https://yandex-music.readthedocs.io/en/main/yandex_music.rotor.rotor_settings.html). Официальной документации нет; значения проверять живыми запросами.
- Идея для нашего клиента (клиентская сторона): хранить локальную историю последних N треков и отфильтровывать/пропускать повторы и дизлайкнутые при получении батча rotor (`rotor/station/.../tracks` с `queue` последнего трека); хранить свой «бан-лист» исполнителей. Реализация и поведение API не проверены, это гипотеза.

## 4. Цензура

- Двухэтапная модерация загружаемого контента (нейросеть, затем люди), метка Explicit, возможно скрытие из рекомендаций или удаление; инициатор — Ассоциация музыкальной индустрии. https://www.iguides.ru/main/other/yandeks_muzyka_nachala_zhestko_tsenzurirovat_treki/ , https://www.securitylab.ru/news/543246.php
- В 2023 по требованию властей удалено более 4000 треков и подкастов: https://novayagazeta.eu/articles/2023/11/01/iandeks-muzyka-po-trebovaniiu-vlastei-udalila-bolee-chetyrekh-tysiach-pesen-i-podkastov-s-nachala-goda-news
- Октябрь 2025: в треке Anacondaz «Мама, я люблю» вырезали слова, на их месте гитарные риффы; «Ярче звезд» (полматери) — заменены отдельные слова: https://novayagazeta.eu/articles/2025/10/07/na-iandeks-muzyke-zatsenzurili-trek-anacondaz-mama-ia-liubliu-iz-pesni-ubrali-slova-kokain-satana-i-nekrofil-news ; общий обзор: https://novayagazeta.ru/articles/2025/05/20/a-ne-to-ia-zavoiu-a-ne-to-ia-zalaiu
- Настройки: «Настройки приложения» -> «Фильтрация контента для взрослых» (вариант «Без ограничений»), метка «E» у треков с матом; альбомы могут иметь «Другие версии» (ищите версию без цензуры). «Детский режим» управляет разделом «Детям». https://teletype.in/@soveti/kak-ubrat-detskij-rezhim-yandeks-muzyka
- Подмена удалённых треков лайвами/каверами в плейлистах (жалобы dtf).
- Открытых обходов (патчи клиента) не нашёл. Не проверено: отдаёт ли API для цензурированного трека отдельный trackId «чистой» и «оригинальной» версии, и показывает ли поле `contentWarning`/`explicit`. Идея: в нашем клиенте подсвечивать метку «E» и «Другие версии» альбома, предлагать переключение на оригинал; бипы вшиты в аудио, исправить на клиенте нельзя.

## 5. Open-source клиенты и моды

- YandexMusicModClient (TheKing-OfTime), MIT, 601 звезда, в архиве с 9.02.2026 (автор рекомендует PulseSync). Функции: Discord RPC, Last.fm скробблинг, мини-плеер поверх окон, кэш на другой диск, глобальные хоткеи, «повтор трека в Моей волне», отображение кодека/качества, скачивание треков/альбомов/плейлистов/подкастов/книг, масштаб 75-200%, исправления багов, DevTools. Нужна подписка Плюс. https://github.com/TheKing-OfTime/YandexMusicModClient
- PulseSync (бывший YMusic-DRPC): Discord RPC, моды, темы (сообщество), своя лицензия. Темы/тексты/аддоны на странице репозитория не подтверждены. https://github.com/PulseSync-LLC/YMusic-DRPC , https://discord.com/servers/pulsesync-1227552882744754267
- Yandex Music Mod (Discord): https://discord.com/servers/yandex-music-mod-1410905688372154400
- Cassette (GTK/Adwaita, Linux, Flathub): офлайн плейлисты, караоке-режим. https://flathub.org/apps/io.github.Rirusha.Cassette
- YaYmp (Qt, кросс-платформа, лёгкий). https://alternativeto.net/software/yaymp/about/
- YamSync (Android/ПК/iOS, открытый плеер+загрузчик, 10-полосный эквалайзер). https://github.com/audiz/YamSync
- yamusic-tui (Go, TUI). https://gittrend.io/repo/DECE2183/yamusic-tui
- next-music: веб-клиент с темами, аддонами, Discord RPC, OBS-виджетом: https://www.linux-meta.duckdns.org/en/p/next-music
- API-библиотеки: MarshalX/yandex-music-api (Python), kontsevoye/ym-api (Node), p0rterB/YM-API (Swift), yandex-music-open-api. https://github.com/kontsevoye/ym-api , https://github.com/p0rterB/YM-API
- Что ценят: Discord RPC, скачивание/кэш, мини-плеер, Last.fm, хоткеи, темы, лёгкость, караоке/тексты. LRCLIB в найденных проектах не подтверждён (идея для нашего клиента: https://lrclib.net как источник синхронных текстов, не проверено через поиск).

## Источники, которые стоит прочесть дальше
- Wayback Machine music.yandex.ru за 2022 (скриншоты старой главной, CSS-токены).
- 4pda тема Яндекс Музыки (не удалось найти поиском).
- Исходники MarshalX/yandex-music-api: методы `rotor_station_tracks`, `rotor_station_settings2`.
