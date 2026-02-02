const monthMap: { [index: string]: number } = {
  "ENE": 0,
  "FEB": 1,
  "MAR": 2,
  "ABR": 3,
  "MAY": 4,
  "JUN": 5,
  "JUL": 6,
  "AGO": 7,
  "SEP": 8,
  "OCT": 9,
  "NOV": 10,
  "DIC": 11
}

export default function handleDateFormat(date: string) {
  const dateRegex = /(\d\d) (\w\w\w)/
  const match = date.match(dateRegex)
  if (!match) throw new Error(`Date ${date} does not match RegExp pattern`)

  const [ _, day, month ] = match
  const isoDate = new Date(
    2025,
    monthMap[month],
    Number.parseInt(day)
  ).toISOString()
  const datePortion = isoDate.split('T')[0]

  return datePortion
}