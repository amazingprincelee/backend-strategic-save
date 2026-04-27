import mongoose from 'mongoose';

const partnerEarningSchema = new mongoose.Schema({
  partnerId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredUserId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredUserEmail: { type: String, required: true },
  subscriptionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },
  eventType:         { type: String, enum: ['subscription', 'trade4me'], default: 'subscription' },
  amountPaidUSD:     { type: Number, required: true }, // what the referred user paid
  commissionUSD:     { type: Number, required: true }, // partner's cut
  commissionRate:    { type: Number, required: true }, // rate % at time of earning
  status:            { type: String, enum: ['pending', 'paid'], default: 'pending' },
  paidAt:            { type: Date, default: null },
}, { timestamps: true });

partnerEarningSchema.index({ partnerId: 1, createdAt: -1 });
partnerEarningSchema.index({ referredUserId: 1 });

const PartnerEarning = mongoose.model('PartnerEarning', partnerEarningSchema);
export default PartnerEarning;
