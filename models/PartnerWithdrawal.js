import mongoose from 'mongoose';

const partnerWithdrawalSchema = new mongoose.Schema({
  partnerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount:        { type: Number, required: true },
  walletAddress: { type: String, required: true },
  network:       { type: String, default: 'TRC20' }, // TRC20, ERC20, BEP20, etc.
  status:        { type: String, enum: ['pending', 'approved', 'paid', 'rejected'], default: 'pending', index: true },
  adminNote:     { type: String, default: '' },
  txHash:        { type: String, default: null },
  requestedAt:   { type: Date, default: Date.now },
  processedAt:   { type: Date, default: null },
}, { timestamps: true });

partnerWithdrawalSchema.index({ partnerId: 1, createdAt: -1 });

const PartnerWithdrawal = mongoose.model('PartnerWithdrawal', partnerWithdrawalSchema);
export default PartnerWithdrawal;
