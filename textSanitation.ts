  const rowStartRegex = /(\d{2} (?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC))\n/
  
  
  /**
   * Removes of the text in the string
   * leading up to the first transaction row
   * @returns - a new string
   */
  function removeIntroduction(text: string) {
    // Start looking for the first date tag (eg. ENE 01, DIC 31)
    // This should correspond with the start of the transactions table
    const firstRowStart = text.match(rowStartRegex)

    if (!firstRowStart?.[0]) {
      console.log("Row Start Regex failed");
      process.exit(1)
    }

    const rowStartIndex = text.indexOf(firstRowStart[0])
    const sanitizedText = text.slice(rowStartIndex)

    return sanitizedText
  }

  /**
   * Removes the account information at the top of each page 
   * @returns - a new string
   * */
  function removeAccountInfo(text: string) {
    // Remove chunks of account information 
    const accountInfoRegex = /JAKOB ANDREW EDELSTEIN\nTARJETA:\s.*\n.*\nRFC: .*/g;
    const sanitizedText = text.replaceAll(accountInfoRegex, "");
    return sanitizedText
  }

  /**
   * Removes the page count found at the bottom of each page
   * @returns - a new string
   * */
  function removePageCounts(text: string) {
    // Clear out page counts at the end of each page
    const pageCountRegex = /\d+ de \d+\n/g
    const sanitizedText = text.replaceAll(pageCountRegex, "")
    return sanitizedText
  }

  /**
   * Removes all of the text following the final period balance.
   * @returns - a new string
   */
  function removeOutro(text: string) {
    const sanitizedText = text.split("Saldo final del periodo")[0].trim()
    return sanitizedText
  }

  function splitIntoRows(text: string): string[][] {
    const parts = text.split(rowStartRegex)
    // Remove empty element at start
    // Inserted because rowStartRegex has a capturing group
    parts.shift() 
    
    const rows = [];
    for (let i = 1; i < parts.length; i += 2) {
      const row = (parts[i] + " " + parts[i + 1]).split("\n");
      rows.push(row)
    }

    return rows
  }

  export default {
    removeIntroduction,
    removeAccountInfo,
    removePageCounts,
    removeOutro,
    splitIntoRows
  }