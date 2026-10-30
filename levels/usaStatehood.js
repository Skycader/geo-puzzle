// Statehood numbers for the "Номера штатов" mode: the order in which the 50 states joined the
// Union (1 = Delaware … 50 = Hawaii), and the texts of its info modal. Hand-written reference
// data (dates are the official admission dates; for the original 13 — the date they ratified
// the Constitution), keyed by levels/usa.js's piece ids.
//
// North Dakota and South Dakota were admitted on the same day (1889-11-02) and the order between
// them was never fixed — by convention North is 39 and South 40 (alphabetical).
export const STATEHOOD = [
  { order: 1, id: 'DE', date: '1787-12-07' },
  { order: 2, id: 'PA', date: '1787-12-12' },
  { order: 3, id: 'NJ', date: '1787-12-18' },
  { order: 4, id: 'GA', date: '1788-01-02' },
  { order: 5, id: 'CT', date: '1788-01-09' },
  { order: 6, id: 'MA', date: '1788-02-06' },
  { order: 7, id: 'MD', date: '1788-04-28' },
  { order: 8, id: 'SC', date: '1788-05-23' },
  { order: 9, id: 'NH', date: '1788-06-21' },
  { order: 10, id: 'VA', date: '1788-06-25' },
  { order: 11, id: 'NY', date: '1788-07-26' },
  { order: 12, id: 'NC', date: '1789-11-21' },
  { order: 13, id: 'RI', date: '1790-05-29' },
  { order: 14, id: 'VT', date: '1791-03-04' },
  { order: 15, id: 'KY', date: '1792-06-01' },
  { order: 16, id: 'TN', date: '1796-06-01' },
  { order: 17, id: 'OH', date: '1803-03-01' },
  { order: 18, id: 'LA', date: '1812-04-30' },
  { order: 19, id: 'IN', date: '1816-12-11' },
  { order: 20, id: 'MS', date: '1817-12-10' },
  { order: 21, id: 'IL', date: '1818-12-03' },
  { order: 22, id: 'AL', date: '1819-12-14' },
  { order: 23, id: 'ME', date: '1820-03-15' },
  { order: 24, id: 'MO', date: '1821-08-10' },
  { order: 25, id: 'AR', date: '1836-06-15' },
  { order: 26, id: 'MI', date: '1837-01-26' },
  { order: 27, id: 'FL', date: '1845-03-03' },
  { order: 28, id: 'TX', date: '1845-12-29' },
  { order: 29, id: 'IA', date: '1846-12-28' },
  { order: 30, id: 'WI', date: '1848-05-29' },
  { order: 31, id: 'CA', date: '1850-09-09' },
  { order: 32, id: 'MN', date: '1858-05-11' },
  { order: 33, id: 'OR', date: '1859-02-14' },
  { order: 34, id: 'KS', date: '1861-01-29' },
  { order: 35, id: 'WV', date: '1863-06-20' },
  { order: 36, id: 'NV', date: '1864-10-31' },
  { order: 37, id: 'NE', date: '1867-03-01' },
  { order: 38, id: 'CO', date: '1876-08-01' },
  { order: 39, id: 'ND', date: '1889-11-02' },
  { order: 40, id: 'SD', date: '1889-11-02' },
  { order: 41, id: 'MT', date: '1889-11-08' },
  { order: 42, id: 'WA', date: '1889-11-11' },
  { order: 43, id: 'ID', date: '1890-07-03' },
  { order: 44, id: 'WY', date: '1890-07-10' },
  { order: 45, id: 'UT', date: '1896-01-04' },
  { order: 46, id: 'OK', date: '1907-11-16' },
  { order: 47, id: 'NM', date: '1912-01-06' },
  { order: 48, id: 'AZ', date: '1912-02-14' },
  { order: 49, id: 'AK', date: '1959-01-03' },
  { order: 50, id: 'HI', date: '1959-08-21' },
];

export const STATEHOOD_BY_ID = new Map(STATEHOOD.map((s) => [s.id, s]));

// Info modal texts (Russian is the source of truth; EN is the delta, as elsewhere in the app).
export const STATEHOOD_TEXT = {
  ru: {
    why: [
      'Номер штата — порядок, в котором штаты вошли в состав США. Официальной «нумерации штатов» у США нет: номера — это просто счёт по дате вступления, 1–50 подряд, без пропусков.',
      'Первые 13 штатов (бывшие британские колонии) считаются по дате ратификации Конституции США в 1787–1790 годах. Остальные получали номер в момент, когда Конгресс принимал их в Союз. Последние два, Аляска и Гавайи, вступили в 1959 году.',
    ],
    tableHeading: 'Порядок вступления',
    colNo: '№',
    colState: 'Штат',
    colDate: 'Дата',
    tieNote: '* Северная и Южная Дакота приняты в один день; их порядок условный (по алфавиту).',
    originalNote: 'Номера 1–13 — дата ратификации Конституции.',
    factsHeading: 'Интересные факты',
    facts: [
      '**Делавэр** — «Первый штат»: он ратифицировал Конституцию первым (7 декабря 1787) и до сих пор гордится этим, даже на автомобильных номерах.',
      '**Две Дакоты** приняты в один день, 2 ноября 1889. По преданию, президент Гаррисон перемешал бумаги перед подписанием, чтобы никто не узнал, какой штат был первым.',
      '**Огайо** формально стал штатом только в 1953 году: в 1803-м Конгресс так и не принял формального акта о приёме. Спохватились в 1953 году и задним числом назначили датой 1 марта 1803 года, поэтому он 17-й.',
      '**Аляска и Гавайи** вступили в 1959-м, и с тех пор новых штатов не было. Флаг с 50 звёздами утвердили 4 июля 1960 года; его автор — 17-летний школьник Роберт Хефт, который сшил его для школьного задания.',
    ],
  },
  en: {
    why: [
      "A state's number is the order in which it joined the United States. There is no official \"state numbering\": the numbers are simply a count by admission date, 1–50 with no gaps.",
      'The first 13 states (former British colonies) are counted by the date they ratified the US Constitution in 1787–1790. The rest got their number the day Congress admitted them to the Union. The last two, Alaska and Hawaii, joined in 1959.',
    ],
    tableHeading: 'Order of admission',
    colNo: '#',
    colState: 'State',
    colDate: 'Date',
    tieNote: '* North and South Dakota were admitted on the same day; their order is a convention (alphabetical).',
    originalNote: 'Numbers 1–13 use the date of ratifying the Constitution.',
    factsHeading: 'Fun facts',
    facts: [
      '**Delaware** is "The First State": it ratified the Constitution first (7 December 1787) and is still proud of it, even on its license plates.',
      '**The two Dakotas** were admitted on the same day, 2 November 1889. By tradition, President Harrison shuffled the papers before signing so nobody would know which one came first.',
      '**Ohio** only formally became a state in 1953: Congress never passed a formal act of admission in 1803. This was noticed in 1953 and the date was set retroactively to 1 March 1803, which is why Ohio is number 17.',
      '**Alaska and Hawaii** joined in 1959, and there has been no new state since. The 50-star flag was adopted on 4 July 1960; its designer was a 17-year-old student, Robert Heft, who sewed it for a school assignment.',
    ],
  },
};
