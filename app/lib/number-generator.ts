import { db } from "./db/index.js"
import { orders, quotes } from "./db/schema.js"
import { desc, like, eq } from 'drizzle-orm'

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
    // Find ALL numbers for this year and find the highest sequence
    // We need to check all records because we must order by the actual number value, not createdAt
    const table = type === 'order' ? orders : quotes
    
    const allRecords = await db
      .select()
      .from(table)
      .where(like(type === 'order' ? orders.orderNumber : quotes.quoteNumber, `${yearSuffix}%`))
    
    if (allRecords.length > 0) {
      // Find the record with the highest sequence number
      let highestLetter = 'Z'
      let highestLetterIndex = 0
      let highestSequence = 0
      
      for (const record of allRecords) {
        const numberValue = type === 'order' 
          ? (record as { orderNumber: string }).orderNumber 
          : (record as { quoteNumber: string }).quoteNumber
        
        // Parse the number - supports both base format (25Z01001) and suffixed format (25Z01001-B)
        // The suffix (e.g., -A, -B, -AB) is optional and used for related orders
        const match = numberValue.match(/^(\d{2})([A-Z])(\d{5})(?:-[A-Z]+)?$/)
        if (match) {
          const [, numberYear, letter, sequence] = match
          
          if (numberYear === yearSuffix) {
            const letterIndex = letterSequence.indexOf(letter)
            const sequenceNum = parseInt(sequence, 10)
            
            // Compare: higher letter index means further in sequence (Z=0, Y=1, etc.)
            // A higher letter index OR same letter with higher sequence wins
            // Note: We compare base sequences only - suffixes like -A, -B are variants of the same base
            if (letterIndex > highestLetterIndex || 
                (letterIndex === highestLetterIndex && sequenceNum > highestSequence)) {
              highestLetterIndex = letterIndex
              highestLetter = letter
              highestSequence = sequenceNum
            }
          }
        }
      }
      
      // Increment from the highest found
      if (highestSequence >= 99999) {
        // Need to move to the next letter
        if (highestLetterIndex < letterSequence.length - 1) {
          currentLetter = letterSequence[highestLetterIndex + 1]
          currentNumber = 1
        } else {
          throw new Error(`Maximum number reached for year ${currentYear}`)
        }
      } else if (highestSequence > 0) {
        currentLetter = highestLetter
        currentNumber = highestSequence + 1
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

/**
 * Generates a unique order number with retry logic to handle race conditions.
 * This function will retry up to maxRetries times if a duplicate is detected.
 * Use this function when creating orders in high-concurrency scenarios.
 */
export async function generateUniqueOrderNumber(year?: number, maxRetries = 5): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const orderNumber = await getNextOrderNumber(year)
    
    // Check if this order number already exists
    const existing = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1)
    
    if (existing.length === 0) {
      return orderNumber
    }
    
    // If duplicate found, wait a small random amount and retry
    // This helps stagger concurrent requests
    console.warn(`Order number ${orderNumber} already exists, retrying (attempt ${attempt + 1}/${maxRetries})`)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50))
  }
  
  // If all retries fail, throw an error
  throw new Error('Failed to generate unique order number after maximum retries')
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