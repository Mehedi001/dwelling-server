require("dotenv").config();
const { ObjectId } = require("mongodb");
const SSLCommerzPayment = require("sslcommerz-lts");
const {
  roomsDB,
  pendingPaymentDB,
  usersDB,
  paymentDB,
} = require("../../../db/mongodb");
const store_id = process.env.SSL_STORE_ID;
const store_passwd = process.env.SSL_SECRET_KEY;
const is_live = false; //true for live, false for sandbox

const randomIXID = new ObjectId().toString().replace(/-/g, "");

const paymentIntentSSL = async (req, res) => {
  const { uid } = req?.uid;
  const { roomID, checkIn, checkOut, guest = 1 } = req?.body;

  const startDate = new Date(checkIn);
  const endDate = new Date(checkOut);
  const timeDifference = endDate?.getTime() - startDate.getTime();
  const numberOfNights = Math?.ceil(timeDifference / (1000 * 60 * 60 * 24));

  const findRoom = await roomsDB.findOne({ _id: new ObjectId(roomID) });
  if (!findRoom) {
    return res.status(404).send({ msg: "Room data not found" });
  }
  const guestInfo = await usersDB.findOne({ _id: new ObjectId(uid) });
  if (!guestInfo) {
    return res.status(404).send({ msg: "Guest data not found" });
  }
  const hostInfo = await usersDB.findOne({ _id: new ObjectId(findRoom?.host) });
  if (!hostInfo) {
    return res.status(404).send({ msg: "Host data not found" });
  }

  const finalAmount = findRoom?.price + findRoom?.taxes;
  const multiplier = finalAmount * guest * numberOfNights;

  const data = {
    total_amount: multiplier * 106,
    currency: "BDT",
    tran_id: randomIXID,
    success_url: `https://dwelling-bright-server.vercel.app/api/v2/payment/success/intent?txid=${randomIXID}&pay=true&rm=${roomID}&dwl=ling&ht=bright`,
    fail_url: `https://dwelling-bright-server.vercel.app/api/v2/payment/failed/intent?txid=${randomIXID}&pay=false&rm=${roomID}&dwl=ling&ht=bright`,
    cancel_url: `https://dwelling-bright-server.vercel.app/api/v2/payment/failed/intent?txid=${randomIXID}&pay=false&rm=${roomID}&dwl=ling&ht=bright`,
    ipn_url: "https://dwelling-bright.vercel.app/ipn",
    shipping_method: "dwelling - a commerz",
    product_name: findRoom?.name || "",
    product_category: findRoom?.category || "",
    product_profile: "general",
    cus_name: guestInfo?.name || "",
    cus_email: guestInfo?.email || "dwelling@example.com",
    cus_add1: guestInfo?.address || "",
    cus_add2: "",
    cus_city: guestInfo?.city || "",
    cus_state: "",
    cus_postcode: guestInfo?.postcode || "",
    cus_country: guestInfo?.country || "",
    cus_phone: guestInfo?.phone || "0123456789",
    cus_fax: "",
    ship_name: "dwelling",
    ship_add1: "Dhaka",
    ship_add2: "Dhaka",
    ship_city: "Dhaka",
    ship_state: "Dhaka",
    ship_postcode: 1000,
    ship_country: "Bangladesh",
  };
  const paymentData = {
    ...req?.body,
    nights: numberOfNights,
    date: new Date(),
    gateway: "ssl",
    paymentInfo: {
      txid: data?.tran_id,
      amount: data?.total_amount,
      currency: data?.currency,
      product_name: data?.product_name,
      product_category: data?.product_category,
      cus_name: data?.cus_name,
      cus_email: data?.cus_email,
      cus_phone: data?.cus_phone,
      cus_add1: data?.cus_add1,
      cus_city: data.cus_city,
      cus_country: data?.cus_country,
      cus_postcode: data?.cus_postcode,
    },
    status: "pending",
    hostInfo,
    guestInfo,
  };

  const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
  sslcz.init(data).then(async (apiResponse) => {
    let GatewayPageURL = await apiResponse.GatewayPageURL;
    const insertPending = await pendingPaymentDB.insertOne(paymentData);
    if (insertPending.insertedId)
      res.status(200).send({ msg: "Success", url: GatewayPageURL });
  });
};

const paymentFailedSSL = async (req, res) => {
  try {
    const { rm, txid } = req.query;
    const findPending = await pendingPaymentDB.findOne({ roomID: rm });
    if (!findPending) {
      return res.status(404).send({ msg: "Payment not found" });
    }
    await pendingPaymentDB.deleteOne({
      roomID: rm,
    });
    return res.redirect(
      `https://dwelling-bright.vercel.app/payment/intent?txid=${txid}&pay=false&rm=${rm}&dwl=ling&ht=bright`
    );
  } catch (error) {
    return res.status(500).send({ msg: "Internal Server Error" });
  }
};

const paymentAcceptSSL = async (req, res) => {
  try {
    const { rm, txid } = req.query;
    const findPending = await pendingPaymentDB.findOne({ roomID: rm });
    if (!findPending) {
      return res.status(404).send({ msg: "Payment not found" });
    }
    await pendingPaymentDB.updateOne(
      { roomID: rm },
      {
        $set: {
          status: "success",
        },
      }
    );
    const findPayment = await pendingPaymentDB.findOne({ roomID: rm });
    await paymentDB.insertOne(findPayment);
    await pendingPaymentDB.deleteOne({ roomID: rm });
    return res.redirect(
      `https://dwelling-bright.vercel.app/payment/intent?txid=${txid}&pay=true&rm=${rm}&dwl=ling&ht=bright`
    );
  } catch (error) {
    return res.status(500).send({ msg: "Internal Server Error" });
  }
};

module.exports = {
  paymentAcceptSSL,
  paymentIntentSSL,
  paymentFailedSSL,
};
