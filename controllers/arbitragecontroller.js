import ccxt from "ccxt"


export const fetchExchanges = async(req, res)=>{
  try {

    const exchanges = await ccxt.exchanges
     
    return  res.status(200).json({exchanges: exchanges[8]})
    
  } catch (error) {
    return res.status(500).json({message: "Internal server error"})
  }
}