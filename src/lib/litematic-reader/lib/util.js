export function checkExhaustive (a) {
  throw new Error(`Unexpected case: ${a}`)
}
export function assertInstanceOf (value, constructorType) {
  if (!(value instanceof constructorType)) {
    throw new Error(`Expected element ${value} to be ${constructorType}`)
  }
  return value
}
export function assertNotNull (a) {
  if (a == null) {
    throw new Error('Got null value.')
  }
  return a
}
export function parallelMap (array, options, mapper) {
  return new Promise((resolve, reject) => {
    const result = new Array(array.length)
    let nWorking = 0
    let index = 0
    function startWorking () {
      while (index < array.length && nWorking < options.max) {
        const currentIndex = index
        index++
        const item = array[currentIndex]
        nWorking++
        mapper(item, currentIndex, array)
          .then((v) => {
            result[currentIndex] = v
          })
          .catch((err) => {
            reject(err)
          })
          .finally(() => {
            nWorking--
            startWorking()
          })
      }
      if (index === array.length && nWorking === 0) {
        resolve(result)
      }
    }
    startWorking()
  })
}
export function base64 (array) {
  let binaryString = ''
  for (const i of array) {
    binaryString += String.fromCharCode(i)
  }
  return btoa(binaryString)
}
export function $ (query, constructorType) {
  const element = document.querySelector(query)
  if (!constructorType) {
    return assertInstanceOf(element, undefined)
  } else {
    return assertInstanceOf(element, constructorType)
  }
}
// # sourceMappingURL=util.js.map
