//   protected function getResult()
//   {
//     $arPost = $this->getPost();
//     $arShedule = getIBlockRows(IBLOCK_SHEDULE, ["ID" => $arPost["shedule_id"]]);
//     $shedule = $arShedule[$arPost["shedule_id"]];
//     $arHotel = getIBlockRows(13, ["ID" => $shedule["PROPS"]["HOTEL"]]);

    //     $this->arResult = [
//       "SHEDULE_ID" => $arPost["shedule_id"],
//       "EXCURSION_NAME" => $arPost['excursion_name'],
//       "HOTEL_NAME" => $arHotel[$shedule["PROPS"]["HOTEL"]]['NAME'],
//       "EXCURSION_DATE" => $arShedule[$arPost["shedule_id"]]["PROPS"]["DATE_START"],
//       "PRICE" => ["TYPE1" => $arShedule[$arPost["shedule_id"]]["PROPS"]["PRICE_TYPE1"],
//             "TYPE2" => $arShedule[$arPost["shedule_id"]]["PROPS"]["PRICE_TYPE2"],
//             "TYPE3" => $arShedule[$arPost["shedule_id"]]["PROPS"]["PRICE_TYPE3"]],
//     ];

    //     $arTour = getIBlockRows(10, ["ID" => $shedule["PROPS"]['TOUR']]);
//     $this->arResult['TOUR'] = $arTour[$shedule["PROPS"]['TOUR']];

    //     $arLayout = [
//       [1, 2, '', 3, 4],
//       [5, 6, '', 7, 8],
//       [9, 10, '', 11, 12],
//       [13, 14, '', 15, 16],
//       [17, 18, '', 19, 20],
//       [21, 22, '', 23, 24],
//       [25, 26, '', '', ''],
//       [29, 30, '', '', ''],
//       [33, 34, '', 27, 28],
//       [37, 38, '', 31, 32],
//       [41, 42, '', 35, 36],
//       [45, 46, '', 39, 40],
//       [47, 48, '', 43, 44],
//       ['', '', '', '', ''],
//       [49, 50, 53, 52, 51], 
//     ];
//     $arShedule = getIBlockRows(IBLOCK_SHEDULE, ["PROPERTY_BUS" => $arShedule[$arPost["shedule_id"]]["PROPS"]["BUS"], "PROPERTY_DATE_START" => date('Y-m-d', strtotime($arShedule[$arPost["shedule_id"]]["PROPS"]["DATE_START"]))]);
//     $arBooking = getIBlockRows(IBLOCK_BOORING, ["PROPERTY_SHEDULE_ID" => array_keys($arShedule), 'ACTIVE' => 'Y']);
//     $arTickets = [1,2,3,4];

    //     foreach ($arBooking as $item) {
//       // Безопасное объединение массивов (исправляет первую ошибку PHP 8)
//       $seats = is_array($item["PROPS"]["SEAT"]) ? $item["PROPS"]["SEAT"] : [];
//       $arTickets = array_merge($arTickets, $seats);
//     }

    //     foreach ($arLayout as $row) {
//       foreach ($row as $seat) {
//         if ($seat === '') {
//           $this->arResult["LAYOUT"][] = '<div class="seat empty"></div>';
//         } elseif (in_array($seat, [1,2,3,4])) {
//           $this->arResult["LAYOUT"][] = '<div class="seat quoteNo"></div>';
//         } elseif (in_array($seat, $arTickets)) {
//           $this->arResult["LAYOUT"][] = '<div class="seat quoteNo">'. $seat .'</div>';
//         } else {
//           $this->arResult["LAYOUT"][] = '<a href="#" data-price1="' . $this->arResult["PRICE"]["TYPE1"] . '" data-price2="' . $this->arResult["PRICE"]["TYPE2"] . '" data-price3="' . $this->arResult["PRICE"]["TYPE3"] . '"><div class="seat quoteYes">' . $seat . '</div></a>';
//         }
//       }
//     }
//   }