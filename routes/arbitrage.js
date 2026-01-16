import express from 'express'
import { fetchExchanges } from '../controllers/arbitragecontroller.js'


const router = express.Router()

router.get('/fetch-exchanges', fetchExchanges )

export default router
