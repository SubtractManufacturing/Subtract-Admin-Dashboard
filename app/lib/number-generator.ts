import { db } from "./db/index.js"
import { orders, quotes } from "./db/schema.js"
import { desc, like } from 'drizzle-orm'

type NumberType = 'order' | 'quote'

interface GenerateNumberOptions {
  type: NumberType
  year?: number
}

export async function generateHumanReadableNumber({ type, year }: GenerateNumberOptions): Promise<string> {
  const currentYear = year || new Date().getFullYear()
  const yearSuffix = currentYear.toString().slice(-2)
  
  // Define letter sequences (Z, Y, X, W, V, U, T, S, R, Q, P, O, N, M, L, K, J, I, H, G, F, E, D, C, B, A)
  const letterSequence = ['Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P', 'O', 'N', 'M', 'L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A']
  
  // Get the current letter and find the latest number for this year
  let currentLetter = letterSequence[0] // Start with 'Z'
  let currentNumber = 1
  
  try {
    // Find the latest number for this year
    const table = type === 'order' ? orders : quotes
    
    const latestRecord = await db
      .select()
      .from(table)
      .where(like(type === 'order' ? orders.orderNumber : quotes.quoteNumber, `${yearSuffix}%`))
      .orderBy(desc(type === 'order' ? orders.createdAt : quotes.createdAt))
      .limit(1)
    
    if (latestRecord.length > 0) {
      const latestNumber = type === 'order' 
        ? (latestRecord[0] as { orderNumber: string }).orderNumber 
        : (latestRecord[0] as { quoteNumber: string }).quoteNumber
      
      // Parse the latest number (format: 25Z01001)
      const match = latestNumber.match(/^(\d{2})([A-Z])(\d{5})$/)
      if (match) {
        const [, numberYear, letter, sequence] = match
        
        if (numberYear === yearSuffix) {
          // Same year, increment the sequence
          const currentSequence = parseInt(sequence, 10)
          
          if (currentSequence >= 99999) {
            // Need to move to the next letter
            const letterIndex = letterSequence.indexOf(letter)
            if (letterIndex < letterSequence.length - 1) {
              currentLetter = letterSequence[letterIndex + 1]
              currentNumber = 1
            } else {
              throw new Error(`Maximum number reached for year ${currentYear}`)
            }
          } else {
            currentLetter = letter
            currentNumber = currentSequence + 1
          }
        }
        // If different year, start fresh with Z00001
      }
    }
  } catch (error) {
    console.error('Error generating number:', error)
    // Fall back to starting fresh
  }
  
  // Format the number (5 digits with leading zeros)
  const formattedNumber = currentNumber.toString().padStart(5, '0')
  
  return `${yearSuffix}${currentLetter}${formattedNumber}`
}

export async function getNextOrderNumber(year?: number): Promise<string> {
  return generateHumanReadableNumber({ type: 'order', year })
}

export async function getNextQuoteNumber(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear().toString().slice(-2)
  const month = (now.getMonth() + 1).toString()

  try {
    const latestQuotes = await db
      .select()
      .from(quotes)
      .where(like(quotes.quoteNumber, `Q${year}${month}-%`))
      .orderBy(desc(quotes.createdAt))
      .limit(1)

    if (latestQuotes.length > 0) {
      const latestNumber = latestQuotes[0].quoteNumber
      const match = latestNumber.match(/^Q(\d{2})(\d{1,2})-([A-Z])(\d+)$/)

      if (match) {
        const [, numberYear, numberMonth, letter, sequence] = match

        if (numberYear === year && numberMonth === month) {
          const currentSequence = parseInt(sequence, 10)

          if (currentSequence >= 999) {
            const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1)
            if (nextLetter > 'Z') {
              throw new Error(`Maximum number reached for month ${year}/${month}`)
            }
            return `Q${year}${month}-${nextLetter}100`
          }

          return `Q${year}${month}-${letter}${(currentSequence + 1).toString().padStart(3, '0')}`
        }
      }
    }

    return `Q${year}${month}-A100`
  } catch (error) {
    console.error('Error generating quote number:', error)
    return `Q${year}${month}-A100`
  }
}